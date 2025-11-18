import puppeteer, { Browser, Page, ElementHandle } from "puppeteer";
import { ScrapeConfig, ScrapedImage } from "../shared/schema";
import { storage } from "./storage";
import { normalizeDate } from "./utils/date-normalization";
import { generateCaption } from "./utils/caption-generator";
import { transformToCleanMetadata } from "./utils/metadata-normalizer";
import { failedScrapesLogger, FailedScrape } from "./utils/failed-scrapes-logger";

type ScrapeProgress = {
  percentage: number;
  current: number;
  total: number;
  status: string;
};

type ScrapeCallbacks = {
  onProgress?: (scrapedCount: number, totalCount: number) => void;
  onComplete?: (images: ScrapedImage[]) => void;
  onError?: (error: Error) => void;
};

// Metadata cache for network-intercepted data
const metadataCache = new Map<string, any>();

class SmartFrameScraper {
  private browser: Browser | null = null;

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async scrape(
    jobId: string,
    url: string,
    config: ScrapeConfig,
    callbacks: ScrapeCallbacks = {}
  ): Promise<ScrapedImage[]> {
    await this.initialize();
    const page = await this.browser!.newPage();

    // Initialize failed scrapes logger for this job
    failedScrapesLogger.startJob(jobId);

    try {
      await storage.updateScrapeJob(jobId, { status: "scraping" });
      
      console.log('\n' + '='.repeat(60));
      console.log('STARTING SCRAPE JOB');
      console.log('='.repeat(60));
      console.log(`Job ID: ${jobId}`);
      console.log(`Target URL: ${url}`);
      console.log(`Max Images: ${config.maxImages === 0 ? 'Unlimited' : config.maxImages}`);
      console.log(`Extract Details: ${config.extractDetails ? 'Yes' : 'No'}`);
      console.log(`Auto-scroll: ${config.autoScroll ? 'Yes' : 'No'}`);
      console.log('='.repeat(60) + '\n');
      
      // Anti-detection setup
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      
      // Add benign headers that are safe to apply globally
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      });
      
      // Enhanced stealth mode - hide webdriver and spoof browser properties
      await page.evaluateOnNewDocument(() => {
        // Hide webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // Add plugins to appear more like a real browser
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        
        // Add languages array
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        
        // Add chrome runtime object (present in real Chrome browsers)
        (window as any).chrome = {
          runtime: {}
        };
      });

      // Setup network interception for API metadata (Strategy A)
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        request.continue();
      });

      page.on('response', async (response) => {
        const url = response.url();
        // Intercept SmartFrame API metadata calls
        if (url.includes('smartframe.') && (url.includes('/api/') || url.includes('/metadata') || url.includes('/image/'))) {
          try {
            const contentType = response.headers()['content-type'];
            if (contentType && contentType.includes('application/json')) {
              const data = await response.json();
              if (data && (data.imageId || data.image_id || data.id)) {
                const imageId = data.imageId || data.image_id || data.id;
                metadataCache.set(imageId, data);
                console.log(`Cached metadata for image: ${imageId}`);
              }
            }
          } catch (error) {
            // Silently skip non-JSON responses
          }
        }
      });

      console.log(`Navigating to ${url}...`);
      
      // Retry navigation with exponential backoff
      let attempts = 0;
      const maxAttempts = 3;
      let navigationSuccess = false;

      while (attempts < maxAttempts && !navigationSuccess) {
        attempts++;
        console.log(`Navigation attempt ${attempts}/${maxAttempts} to ${url}`);
        
        try {
          await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
          });
          navigationSuccess = true;
        } catch (error) {
          console.error(`Navigation attempt ${attempts} failed:`, error);
          if (attempts === maxAttempts) throw error;
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts)); // Exponential backoff
        }
      }

      // Wait for SmartFrame embeds to load
      try {
        await page.waitForSelector('smartframe-embed, .sf-thumbnail, [data-testid="image-card"]', { timeout: 15000 });
      } catch (error) {
        console.log("SmartFrame elements not found with standard selectors, trying fallback...");
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Extract thumbnails from search page
      const thumbnails = await this.extractThumbnailsFromSearch(page);
      console.log(`Extracted ${thumbnails.size} thumbnails from search page`);

      // Create accumulator for incrementally discovered image links
      const discoveredLinks = new Map<string, { url: string; imageId: string; hash: string }>();

      // NEW: Collect initial page before autoScroll starts
      console.log('Collecting images from initial page...');
      const initialPageLinks = await this.collectPageImageLinks(page);
      for (const link of initialPageLinks) {
        discoveredLinks.set(link.imageId, link);
      }
      console.log(`Initial page: collected ${discoveredLinks.size} images`);

      // Auto-scroll to load all images with incremental collection
      if (config.autoScroll) {
        await this.autoScroll(
          page, 
          config.maxImages, 
          config.scrollDelay || 1000, 
          async (progress: ScrapeProgress) => {
            await storage.updateScrapeJob(jobId, {
              progress: Math.round(progress.percentage),
              scrapedImages: progress.current,
              totalImages: progress.total,
            });
          },
          async () => {
            // Collect images from current page after each pagination
            const pageLinks = await this.collectPageImageLinks(page);
            for (const link of pageLinks) {
              discoveredLinks.set(link.imageId, link);
            }
            console.log(`Collected ${discoveredLinks.size} unique images so far`);
          }
        );
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      // Collect final page images
      const finalPageLinks = await this.collectPageImageLinks(page);
      for (const link of finalPageLinks) {
        discoveredLinks.set(link.imageId, link);
      }

      const imageLinks = Array.from(discoveredLinks.values());
      console.log(`Total unique images collected: ${imageLinks.length}`);

      const limitedLinks = config.maxImages === 0 ? imageLinks : imageLinks.slice(0, config.maxImages);

      console.log(`Processing ${limitedLinks.length} image links`);

      const images: ScrapedImage[] = [];
      const concurrency = config.concurrency || 5;
      
      console.log(`\n🚀 Parallel Processing Enabled: ${concurrency} concurrent tabs`);
      console.log(`Processing ${limitedLinks.length} images...\n`);

      // Process images in parallel using worker pool
      const processedImages = await this.processImagesInParallel(
        limitedLinks,
        thumbnails,
        config.extractDetails,
        concurrency,
        jobId,
        async (currentImages: ScrapedImage[], attemptedCount: number) => {
          // Progress based on attempted count (reaches 100% when all links processed)
          const progress = Math.round((attemptedCount / limitedLinks.length) * 100);
          await storage.updateScrapeJob(jobId, {
            progress,
            scrapedImages: currentImages.length,
            totalImages: limitedLinks.length,
          });

          if (callbacks.onProgress) {
            callbacks.onProgress(currentImages.length, limitedLinks.length);
          }
        }
      );
      
      images.push(...processedImages);

      // Retry failed images with controlled concurrency
      const failures = failedScrapesLogger.getFailures();
      if (failures.length > 0 && config.extractDetails) {
        console.log(`\n🔄 Retrying ${failures.length} failed images...`);
        const retriedImages = await this.retryFailedImages(
          failures,
          thumbnails,
          2, // Lower concurrency for retries to avoid rate limiting
          jobId
        );
        
        if (retriedImages.length > 0) {
          images.push(...retriedImages);
          console.log(`✅ Successfully recovered ${retriedImages.length} images through retries\n`);
        }
      }

      // Transform raw scraped data to clean metadata format
      console.log('\n🧹 Cleaning and normalizing metadata...');
      const cleanImages = images.map(img => transformToCleanMetadata(img as any));
      console.log(`✓ Transformed ${cleanImages.length} images to clean metadata format\n`);

      // Final update with complete results (progress will be 100% since all were attempted)
      await storage.updateScrapeJob(jobId, {
        status: "completed",
        progress: 100,
        scrapedImages: cleanImages.length,
        totalImages: limitedLinks.length,
        images: cleanImages,
        completedAt: new Date().toISOString(),
      });

      // Write failed scrapes log file if there were any failures
      const failedCount = failedScrapesLogger.getFailureCount();
      if (failedCount > 0) {
        const logFilePath = await failedScrapesLogger.writeLogFile();
        console.log(`\n⚠️  ${failedCount} images failed after all retry attempts`);
        if (logFilePath) {
          console.log(`📝 Failed scrapes logged to: ${logFilePath}`);
        }
      }

      // Log detailed export information
      console.log('\n' + '='.repeat(60));
      console.log('SCRAPING COMPLETED SUCCESSFULLY');
      console.log('='.repeat(60));
      console.log(`Total images scraped: ${cleanImages.length}`);
      console.log(`Total images attempted: ${limitedLinks.length}`);
      console.log(`Failed images (after retries): ${failedCount}`);
      console.log(`Success rate: ${((cleanImages.length / limitedLinks.length) * 100).toFixed(1)}%`);
      if (failures.length > 0) {
        const recoveredCount = failures.length - failedCount;
        console.log(`Images recovered via retry: ${recoveredCount}`);
      }
      console.log(`Job ID: ${jobId}`);
      
      // Show sample of extracted data
      if (images.length > 0) {
        console.log('\nData fields extracted for each image:');
        const sampleImage = images[0];
        const fields = [
          { name: 'Image ID', value: sampleImage.smartframeId },
          { name: 'URL', value: sampleImage.url },
          { name: 'Content Partner', value: sampleImage.contentPartner || 'N/A' },
          { name: 'Photographer', value: sampleImage.photographer || 'N/A' },
          { name: 'Image Size', value: sampleImage.imageSize || 'N/A' },
          { name: 'File Size', value: sampleImage.fileSize || 'N/A' },
          { name: 'City', value: sampleImage.city || 'N/A' },
          { name: 'Country', value: sampleImage.country || 'N/A' },
          { name: 'Date', value: sampleImage.date || 'N/A' },
          { name: 'Event', value: sampleImage.matchEvent || 'N/A' },
          { name: 'Keywords', value: sampleImage.tags.length > 0 ? `${sampleImage.tags.length} keywords` : 'N/A' },
          { name: 'Thumbnail URL', value: sampleImage.thumbnailUrl ? 'Available' : 'N/A' },
        ];
        
        fields.forEach(field => {
          console.log(`  - ${field.name}: ${field.value}`);
        });
      }
      
      console.log('\n' + '-'.repeat(60));
      console.log('HOW TO EXPORT YOUR DATA:');
      console.log('-'.repeat(60));
      console.log('1. Open your browser to: http://localhost:5000');
      console.log('2. Click the "Export Data" button in the top-right corner');
      console.log('3. Choose your preferred format:');
      console.log('   - JSON: Full structured data with all metadata');
      console.log('   - CSV: Spreadsheet format for Excel/Google Sheets');
      console.log('\nAlternatively, use the API directly:');
      console.log(`   GET http://localhost:5000/api/export/${jobId}?format=json`);
      console.log(`   GET http://localhost:5000/api/export/${jobId}?format=csv`);
      console.log('='.repeat(60) + '\n');

      if (callbacks.onComplete) {
        callbacks.onComplete(images);
      }

      return images;
    } catch (error) {
      console.error("Scraping error:", error);
      await storage.updateScrapeJob(jobId, {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error occurred",
      });

      if (callbacks.onError && error instanceof Error) {
        callbacks.onError(error);
      }

      throw error;
    } finally {
      await page.close();
    }
  }

  private async processImagesInParallel(
    linkData: Array<{ url: string; imageId: string; hash: string }>,
    thumbnails: Map<string, string>,
    extractDetails: boolean,
    concurrency: number,
    jobId: string,
    onProgress: (currentImages: ScrapedImage[], attemptedCount: number) => Promise<void>
  ): Promise<ScrapedImage[]> {
    const results: ScrapedImage[] = [];
    let attemptedCount = 0;
    
    // Create a pool of worker pages
    const workerPages: Page[] = [];
    for (let i = 0; i < concurrency; i++) {
      const workerPage = await this.browser!.newPage();
      
      // Apply anti-detection setup to each worker page
      await workerPage.setViewport({ width: 1920, height: 1080 });
      await workerPage.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await workerPage.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      });
      await workerPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        (window as any).chrome = { runtime: {} };
      });
      
      workerPages.push(workerPage);
    }

    try {
      // Process in batches
      const batchSize = concurrency;
      for (let i = 0; i < linkData.length; i += batchSize) {
        const batch = linkData.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (link, index) => {
          const workerPage = workerPages[index % concurrency];
          
          try {
            const image = await this.extractImageData(
              workerPage,
              link.url,
              link.imageId,
              link.hash,
              extractDetails,
              thumbnails.get(link.imageId)
            );
            
            if (image) {
              console.log(`✓ [${attemptedCount + 1}/${linkData.length}] ${link.imageId}`);
              return image;
            }
          } catch (error) {
            console.error(`✗ Error scraping ${link.url}:`, error instanceof Error ? error.message : error);
            // Log the failure from uncaught exception
            failedScrapesLogger.addFailure({
              imageId: link.imageId,
              url: link.url,
              reason: `Uncaught exception: ${error instanceof Error ? error.message : String(error)}`,
              attempts: 1,
              timestamp: new Date().toISOString()
            });
          }
          
          return null;
        });

        const batchResults = await Promise.all(batchPromises);
        const validImages = batchResults.filter((img): img is ScrapedImage => img !== null);
        results.push(...validImages);
        attemptedCount += batch.length;
        
        // Update progress with immutable snapshot of accumulated results after each batch
        // Progress is based on attempted count, not successful count
        await onProgress([...results], attemptedCount);
        
        // Small delay between batches to avoid overwhelming the server
        if (i + batchSize < linkData.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } finally {
      // Clean up worker pages
      await Promise.all(workerPages.map(page => page.close().catch(() => {})));
    }

    console.log(`\n✅ Parallel processing complete: ${results.length} images extracted\n`);
    return results;
  }

  private async extractThumbnailsFromSearch(page: Page): Promise<Map<string, string>> {
    const thumbnailMap = new Map<string, string>();

    try {
      const thumbnails = await page.evaluate(() => {
        const results: Array<{ imageId: string; thumbnailUrl: string }> = [];

        // Extract from smartframe-embed elements
        const embeds = document.querySelectorAll('smartframe-embed');
        embeds.forEach((embed) => {
          const imageId = embed.getAttribute('image-id');
          if (imageId) {
            // Try to get thumbnail from computed style or child img
            const img = embed.querySelector('img');
            const thumbnailUrl = img?.src || '';
            if (thumbnailUrl) {
              results.push({ imageId, thumbnailUrl });
            }
          }
        });

        return results;
      });

      thumbnails.forEach(({ imageId, thumbnailUrl }) => {
        thumbnailMap.set(imageId, thumbnailUrl);
      });
    } catch (error) {
      console.error('Error extracting thumbnails:', error);
    }

    return thumbnailMap;
  }

  private async collectPageImageLinks(page: Page): Promise<Array<{ url: string; imageId: string; hash: string }>> {
    return await page.evaluate(() => {
      const links: Array<{ url: string; imageId: string; hash: string }> = [];
      
      // Method 1: smartframe-embed elements
      const embeds = document.querySelectorAll('smartframe-embed');
      embeds.forEach((embed) => {
        const imageId = embed.getAttribute('image-id');
        const customerId = embed.getAttribute('customer-id');
        if (imageId && customerId) {
          links.push({
            url: `https://smartframe.com/search/image/${customerId}/${imageId}`,
            imageId: imageId,
            hash: customerId
          });
        }
      });

      // Method 2: Direct links to /search/image/
      const thumbnailLinks = document.querySelectorAll('a[href*="/search/image/"]');
      thumbnailLinks.forEach((link) => {
        const href = (link as HTMLAnchorElement).href;
        const match = href.match(/\/search\/image\/([^\/]+)\/([^\/\?]+)/);
        if (match && !links.some(l => l.imageId === match[2])) {
          links.push({
            url: href,
            imageId: match[2],
            hash: match[1]
          });
        }
      });

      // Method 3: Data attributes on containers
      const containers = document.querySelectorAll('[data-image-id], .sf-thumbnail');
      containers.forEach((container) => {
        const imageId = container.getAttribute('data-image-id');
        const hash = container.getAttribute('data-customer-id') || container.getAttribute('data-hash');
        
        if (imageId && hash && !links.some(l => l.imageId === imageId)) {
          links.push({
            url: `https://smartframe.com/search/image/${hash}/${imageId}`,
            imageId: imageId,
            hash: hash
          });
        }
      });

      return links;
    });
  }

  private async autoScroll(
    page: Page, 
    maxImages: number, 
    scrollDelay: number, 
    onProgress: (progress: ScrapeProgress) => void,
    onPageChange?: () => Promise<void>
  ): Promise<void> {
    let previousHeight;
    let imageCount = 0;
    const loadedImageUrls = new Set<string>();
    const visitedPages = new Set<string>(); // Track visited pages to prevent loops
    let lastPageUrl = ''; // Track last page URL to detect pagination changes
    let justClickedPagination = false; // Track if we just clicked pagination to skip visited check

    // CSS selectors that can be used with page.$$()
    const loadMoreSelectors = [
      '[data-testid="load-more"]',
      'button.load-more',
      '#load-more-button',
      'button[class*="load-more"]',
      'button[class*="rounded-r-md"]', // Next button in pagination (right-rounded button)
      '[aria-label*="Load"]',
      '[aria-label*="Next"]',
      '[aria-label*="next"]',
      '.pagination button',
      '.pagination a',
      'nav button',
      'nav a',
      'button', // Fallback: check all buttons
      'a[href*="page"]', // Links with "page" in href
    ];

    const isUnlimited = maxImages === 0;
    const patienceRounds = 5; // Number of retry rounds when scroll height stops increasing
    const patienceDelay = scrollDelay * 2; // Delay between patience rounds
    console.log(`Starting auto-scroll (target: ${isUnlimited ? 'unlimited' : maxImages} images, delay: ${scrollDelay}ms, patience: ${patienceRounds} rounds)`);

    while (isUnlimited || imageCount < maxImages) {
      // Get current page state for comparison
      const currentUrl = page.url();
      const currentPageKey = currentUrl + '-' + imageCount; // Unique key for this page state
      
      // Check if we've already processed this exact page state (skip if we just clicked pagination)
      if (!justClickedPagination && visitedPages.has(currentPageKey)) {
        console.log(`Already visited page state: ${currentPageKey}. Breaking pagination loop.`);
        break;
      }
      
      // Reset the flag at the start of each iteration
      justClickedPagination = false;
      
      visitedPages.add(currentPageKey);
      
      const thumbnails = await page.$$('img');
      imageCount = thumbnails.length;
      console.log(`Scrolled to ${await page.evaluate(() => document.body.scrollHeight)}px, found ${imageCount} images`);

      onProgress({
        percentage: isUnlimited ? 0 : (imageCount / maxImages) * 100,
        current: imageCount,
        total: isUnlimited ? imageCount : maxImages,
        status: 'Scrolling and discovering images...',
      });

      // Attempt to click "Load More" or "Next" button if it exists and is visible
      let loadMoreButton: ElementHandle<Element> | null = null;
      let matchedSelector = '';
      let buttonText = '';
      
      // First, try to find pagination buttons by evaluating all buttons and getting the element
      try {
        const buttonInfo = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          
          // Priority 1: Look for "Next" buttons specifically
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent?.toLowerCase().trim() || '';
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
            
            // Check if this is specifically a "Next" button
            if (text === 'next' || ariaLabel === 'next' || text.startsWith('next')) {
              // Check if button is enabled and visible
              const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
              if (isDisabled) continue;
              
              const rect = btn.getBoundingClientRect();
              const isVisible = rect.top >= 0 && 
                               rect.left >= 0 && 
                               rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) * 2 &&
                               rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
                               rect.width > 0 && rect.height > 0;
              
              if (isVisible && btn instanceof HTMLElement) {
                const style = window.getComputedStyle(btn);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  return {
                    found: true,
                    index: i,
                    text: btn.textContent?.trim() || '',
                    tagName: btn.tagName.toLowerCase()
                  };
                }
              }
            }
          }
          
          // Priority 2: Look for other pagination buttons
          for (let i = 0; i < buttons.length; i++) {
            const btn = buttons[i];
            const text = btn.textContent?.toLowerCase() || '';
            const classList = Array.from(btn.classList || []);
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
            
            // Check if this is a pagination button
            const isPaginationText = text.includes('load more') || 
                                     text.includes('show more') ||
                                     text.includes('load all');
            
            const isPaginationClass = classList.some(cls => 
              cls.includes('load') || 
              cls.includes('pagination') ||
              cls.includes('rounded-r-md') // Specific to Next button in the provided HTML
            );
            
            const isPaginationAria = ariaLabel.includes('load') ||
                                     ariaLabel.includes('more');
            
            if (isPaginationText || isPaginationClass || isPaginationAria) {
              // Check if button is enabled and visible
              const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
              if (isDisabled) continue;
              
              const rect = btn.getBoundingClientRect();
              const isVisible = rect.top >= 0 && 
                               rect.left >= 0 && 
                               rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) * 2 &&
                               rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
                               rect.width > 0 && rect.height > 0;
              
              if (isVisible && btn instanceof HTMLElement) {
                const style = window.getComputedStyle(btn);
                if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                  return {
                    found: true,
                    index: i,
                    text: btn.textContent?.trim() || '',
                    tagName: btn.tagName.toLowerCase()
                  };
                }
              }
            }
          }
          return { found: false };
        });
        
        if (buttonInfo.found) {
          // Get the actual element handle
          const allButtons = await page.$$('button, a');
          if (buttonInfo.index !== undefined && allButtons[buttonInfo.index]) {
            loadMoreButton = allButtons[buttonInfo.index];
            matchedSelector = 'evaluated pagination button';
            buttonText = buttonInfo.text || '';
            console.log(`Found pagination button with text: "${buttonText}"`);
          }
        }
      } catch (error) {
        console.log('Error finding pagination button via evaluation:', error);
      }
      
      // Fallback: try CSS selectors
      if (!loadMoreButton) {
        for (const selector of loadMoreSelectors) {
          try {
            const elements = await page.$$(selector);
            for (const element of elements) {
              const isVisible = await element.isIntersectingViewport();
              if (isVisible) {
                // Check if element is disabled
                const isDisabled = await element.evaluate(el => {
                  return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
                });
                if (isDisabled) continue;
                
                // Check if element text suggests it's a pagination control
                const text = await element.evaluate(el => el.textContent?.toLowerCase().trim() || '');
                const isPagination = text === 'next' ||
                                     text.includes('load') || 
                                     text.includes('more') || 
                                     text.includes('next') || 
                                     text.includes('show');
                
                if (isPagination) {
                  loadMoreButton = element;
                  matchedSelector = selector;
                  buttonText = text;
                  console.log(`Found pagination button with selector: ${selector}, text: "${text}"`);
                  break;
                }
              }
            }
            if (loadMoreButton) break;
          } catch (error) {
            // This selector is not supported or failed, try the next one
          }
        }
      }

      if (loadMoreButton) {
        try {
          // Capture state before clicking
          const beforeClickImageCount = imageCount;
          const beforeClickUrl = page.url();
          
          // Scroll button into view before clicking
          await loadMoreButton.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await loadMoreButton.click();
          console.log(`Clicked pagination button (${matchedSelector}).`);
          
          // Wait longer for page to fully load and new content to appear
          await new Promise(resolve => setTimeout(resolve, scrollDelay + 2000)); // Increased wait time
          
          // Verify that clicking resulted in a change
          const afterClickUrl = page.url();
          const afterClickThumbnails = await page.$$('img');
          const afterClickImageCount = afterClickThumbnails.length;
          
          if (afterClickUrl !== beforeClickUrl) {
            console.log(`Page URL changed from ${beforeClickUrl} to ${afterClickUrl} - pagination successful`);
            lastPageUrl = afterClickUrl; // Update last page URL to detect next pagination
            justClickedPagination = true; // Mark that we just clicked pagination successfully
            if (onPageChange) await onPageChange();
            continue; // Continue to next iteration with new page
          } else if (afterClickImageCount > beforeClickImageCount) {
            console.log(`Image count increased from ${beforeClickImageCount} to ${afterClickImageCount} - pagination successful`);
            justClickedPagination = true; // Mark that we just clicked pagination successfully
            if (onPageChange) await onPageChange();
            continue; // Continue to next iteration with new content
          } else {
            console.log(`Click did not result in page change or new content. Proceeding with scroll.`);
            loadMoreButton = null;
          }
        } catch (error) {
          console.log('Pagination button no longer clickable or disappeared. Proceeding with scroll.');
          loadMoreButton = null;
        }
      }

      previousHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise(resolve => setTimeout(resolve, scrollDelay));

      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === previousHeight) {
        // Height unchanged - check for pagination button that may now be visible at bottom
        console.log('Scroll height unchanged. Checking for pagination button before patience mechanism...');
        
        let paginationButton: ElementHandle<Element> | null = null;
        let paginationSelector = '';
        let paginationButtonText = '';
        
        // Try to find pagination button now that we're at the bottom
        try {
          const buttonInfo = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            
            // Priority 1: Look for "Next" buttons specifically
            for (let i = 0; i < buttons.length; i++) {
              const btn = buttons[i];
              const text = btn.textContent?.toLowerCase().trim() || '';
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
              
              // Check if this is specifically a "Next" button
              if (text === 'next' || ariaLabel === 'next' || text.startsWith('next')) {
                // Check if button is enabled and visible
                const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
                if (isDisabled) continue;
                
                const rect = btn.getBoundingClientRect();
                const isVisible = rect.top >= 0 && 
                                 rect.left >= 0 && 
                                 rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) * 2 &&
                                 rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
                                 rect.width > 0 && rect.height > 0;
                
                if (isVisible && btn instanceof HTMLElement) {
                  const style = window.getComputedStyle(btn);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    return {
                      found: true,
                      index: i,
                      text: btn.textContent?.trim() || '',
                      tagName: btn.tagName.toLowerCase()
                    };
                  }
                }
              }
            }
            
            // Priority 2: Look for other pagination buttons
            for (let i = 0; i < buttons.length; i++) {
              const btn = buttons[i];
              const text = btn.textContent?.toLowerCase() || '';
              const classList = Array.from(btn.classList || []);
              const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
              
              // Check if this is a pagination button
              const isPaginationText = text.includes('load more') || 
                                       text.includes('show more') ||
                                       text.includes('load all');
              
              const isPaginationClass = classList.some(cls => 
                cls.includes('load') || 
                cls.includes('pagination') ||
                cls.includes('rounded-r-md')
              );
              
              const isPaginationAria = ariaLabel.includes('load') ||
                                       ariaLabel.includes('more');
              
              if (isPaginationText || isPaginationClass || isPaginationAria) {
                // Check if button is enabled and visible
                const isDisabled = btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
                if (isDisabled) continue;
                
                const rect = btn.getBoundingClientRect();
                const isVisible = rect.top >= 0 && 
                                 rect.left >= 0 && 
                                 rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) * 2 &&
                                 rect.right <= (window.innerWidth || document.documentElement.clientWidth) &&
                                 rect.width > 0 && rect.height > 0;
                
                if (isVisible && btn instanceof HTMLElement) {
                  const style = window.getComputedStyle(btn);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    return {
                      found: true,
                      index: i,
                      text: btn.textContent?.trim() || '',
                      tagName: btn.tagName.toLowerCase()
                    };
                  }
                }
              }
            }
            return { found: false };
          });
          
          if (buttonInfo.found) {
            const allButtons = await page.$$('button, a');
            if (buttonInfo.index !== undefined && allButtons[buttonInfo.index]) {
              paginationButton = allButtons[buttonInfo.index];
              paginationSelector = 'evaluated pagination button';
              paginationButtonText = buttonInfo.text || '';
              console.log(`Found pagination button at bottom with text: "${paginationButtonText}"`);
            }
          }
        } catch (error) {
          console.log('Error finding pagination button at bottom:', error);
        }
        
        // Try CSS selectors as fallback
        if (!paginationButton) {
          for (const selector of loadMoreSelectors) {
            try {
              const elements = await page.$$(selector);
              for (const element of elements) {
                const isVisible = await element.isIntersectingViewport();
                if (isVisible) {
                  // Check if element is disabled
                  const isDisabled = await element.evaluate(el => {
                    return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
                  });
                  if (isDisabled) continue;
                  
                  const text = await element.evaluate(el => el.textContent?.toLowerCase().trim() || '');
                  const isPagination = text === 'next' ||
                                       text.includes('load') || 
                                       text.includes('more') || 
                                       text.includes('next') || 
                                       text.includes('show');
                  
                  if (isPagination) {
                    paginationButton = element;
                    paginationSelector = selector;
                    paginationButtonText = text;
                    console.log(`Found pagination button at bottom with selector: ${selector}, text: "${text}"`);
                    break;
                  }
                }
              }
              if (paginationButton) break;
            } catch (error) {
              // This selector failed, try the next one
            }
          }
        }
        
        // If we found a pagination button, click it
        if (paginationButton) {
          try {
            // Capture state before clicking
            const beforeClickImageCount = imageCount;
            const beforeClickUrl = page.url();
            
            await paginationButton.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await paginationButton.click();
            console.log(`Clicked pagination button at bottom (${paginationSelector}).`);
            
            // Wait longer for page to fully load
            await new Promise(resolve => setTimeout(resolve, scrollDelay + 2000)); // Increased wait time
            
            // Verify that clicking resulted in a change
            const afterClickUrl = page.url();
            const afterClickThumbnails = await page.$$('img');
            const afterClickImageCount = afterClickThumbnails.length;
            
            if (afterClickUrl !== beforeClickUrl) {
              console.log(`Page URL changed after click at bottom - pagination successful`);
              lastPageUrl = afterClickUrl;
              justClickedPagination = true; // Mark that we just clicked pagination successfully
              if (onPageChange) await onPageChange();
              continue; // Continue to next iteration with new page
            } else if (afterClickImageCount > beforeClickImageCount) {
              console.log(`Image count increased after click at bottom - pagination successful`);
              justClickedPagination = true; // Mark that we just clicked pagination successfully
              if (onPageChange) await onPageChange();
              continue; // Continue to next iteration with new content
            } else {
              console.log(`Click at bottom did not result in page change. Proceeding with patience mechanism.`);
            }
          } catch (error) {
            console.log('Failed to click pagination button at bottom. Proceeding with patience mechanism.');
          }
        }
        
        // No pagination button found, try patience mechanism
        console.log('No pagination button found. Starting patience mechanism...');
        let moreImagesLoaded = false;
        
        for (let round = 1; round <= patienceRounds; round++) {
          console.log(`Patience round ${round}/${patienceRounds}: Waiting ${patienceDelay}ms for more images to load...`);
          await new Promise(resolve => setTimeout(resolve, patienceDelay));
          
          const currentHeight = await page.evaluate(() => document.body.scrollHeight);
          if (currentHeight > newHeight) {
            console.log(`Patience round ${round}/${patienceRounds}: New content detected! Scroll height increased from ${newHeight}px to ${currentHeight}px.`);
            moreImagesLoaded = true;
            break;
          }
          
          console.log(`Patience round ${round}/${patienceRounds}: No new content yet (height still ${currentHeight}px).`);
        }
        
        if (!moreImagesLoaded) {
          console.log(`Patience mechanism exhausted after ${patienceRounds} rounds. Reached end of page.`);
          break; // End of page
        }
      }
    }
  }

  // Helper function to clean and validate extracted text (plain JS for serialization)
  private cleanTextHelper(text: string | null): string | null {
    if (!text) return null;
    
    // Early rejection: Check for suspicious patterns in raw text before cleaning
    const lowerText = text.toLowerCase();
    if (lowerText.includes('script') || 
        lowerText.includes('iframe') ||
        lowerText.includes('onclick') ||
        lowerText.includes('onerror') ||
        lowerText.includes('onload')) return null;
    
    // Reject common UI text that's not metadata
    if (lowerText.includes('add to board') ||
        lowerText.includes('copy link') ||
        lowerText.includes('copy embed') ||
        lowerText.includes('google tag manager') ||
        lowerText.includes('smartframe content partner')) return null;
    
    // Multi-step sanitization to remove HTML tags and prevent injection
    let cleaned = text;
    // Step 1: Remove complete tags
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    // Step 2: Remove incomplete tags at start/end
    cleaned = cleaned.replace(/^<[^>]*/, '').replace(/[^<]*>$/, '');
    // Step 3: Remove any remaining angle brackets (prevents any HTML parsing)
    cleaned = cleaned.replace(/[<>]/g, '');
    cleaned = cleaned.trim();
    
    // Reject if text is too long (likely grabbed too much content)
    if (cleaned.length > 200) return null;
    // Reject if text contains multiple newlines (likely multiple elements)
    if (cleaned.split('\n').length > 3) return null;
    
    return cleaned || null;
  }

  private async retryFailedImages(
    failures: FailedScrape[],
    thumbnails: Map<string, string>,
    concurrency: number,
    jobId: string
  ): Promise<ScrapedImage[]> {
    const results: ScrapedImage[] = [];
    let successCount = 0;
    let failCount = 0;
    
    console.log(`Starting retry mechanism with concurrency: ${concurrency}`);
    
    // Create a pool of worker pages for retries
    const workerPages: Page[] = [];
    for (let i = 0; i < concurrency; i++) {
      const workerPage = await this.browser!.newPage();
      
      // Apply anti-detection setup
      await workerPage.setViewport({ width: 1920, height: 1080 });
      await workerPage.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await workerPage.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      });
      await workerPage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        (window as any).chrome = { runtime: {} };
      });
      
      workerPages.push(workerPage);
    }

    try {
      // Process in batches
      const batchSize = concurrency;
      for (let i = 0; i < failures.length; i += batchSize) {
        const batch = failures.slice(i, i + batchSize);
        
        // Process batch in parallel
        const batchPromises = batch.map(async (failure, index) => {
          const workerPage = workerPages[index % concurrency];
          const retryAttempt = (failure.retryAttempt || 0) + 1;
          
          console.log(`🔄 [Retry ${retryAttempt}] Attempting ${failure.imageId} (${i + index + 1}/${failures.length})`);
          
          try {
            // Extract hash from URL (format: /search/image/{hash}/{imageId})
            const urlMatch = failure.url.match(/\/search\/image\/([^\/]+)\/([^\/\?]+)/);
            const hash = urlMatch ? urlMatch[1] : '';
            
            const image = await this.extractImageData(
              workerPage,
              failure.url,
              failure.imageId,
              hash,
              true, // extractDetails is always true for retries
              thumbnails.get(failure.imageId)
            );
            
            // Check if we got meaningful data (not just partial/empty image)
            // Consider it successful if we have at least title or photographer
            if (image && (image.title || image.photographer || image.caption)) {
              console.log(`✅ [Retry ${retryAttempt}] Success: ${failure.imageId}`);
              // Remove from failed list since retry was successful
              failedScrapesLogger.removeSuccess(failure.imageId);
              successCount++;
              return image;
            } else {
              console.log(`❌ [Retry ${retryAttempt}] Still no data: ${failure.imageId}`);
              // Update failure with incremented retry attempt
              failedScrapesLogger.addFailure({
                imageId: failure.imageId,
                url: failure.url,
                reason: `${failure.reason} (retry ${retryAttempt} failed)`,
                attempts: failure.attempts + 1,
                timestamp: new Date().toISOString(),
                httpStatus: failure.httpStatus,
                retryAttempt
              });
              failCount++;
            }
          } catch (error) {
            console.error(`❌ [Retry ${retryAttempt}] Exception for ${failure.imageId}:`, error instanceof Error ? error.message : error);
            // Update failure with exception info
            failedScrapesLogger.addFailure({
              imageId: failure.imageId,
              url: failure.url,
              reason: `Retry ${retryAttempt} exception: ${error instanceof Error ? error.message : String(error)}`,
              attempts: failure.attempts + 1,
              timestamp: new Date().toISOString(),
              httpStatus: failure.httpStatus,
              retryAttempt
            });
            failCount++;
          }
          
          return null;
        });

        const batchResults = await Promise.all(batchPromises);
        const validImages = batchResults.filter((img): img is ScrapedImage => img !== null);
        results.push(...validImages);
        
        // Delay between batches to avoid rate limiting
        if (i + batchSize < failures.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    } finally {
      // Clean up worker pages
      await Promise.all(workerPages.map(page => page.close().catch(() => {})));
    }

    console.log(`\n📊 Retry Summary:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   📈 Recovery rate: ${((successCount / failures.length) * 100).toFixed(1)}%\n`);
    
    return results;
  }

  private parseMetadata(rawData: any): Partial<ScrapedImage> {
    const result: Partial<ScrapedImage> = {
      photographer: null,
      imageSize: null,
      fileSize: null,
      country: null,
      city: null,
      date: null,
      matchEvent: null,
      title: null,
      caption: null,
      captionRaw: null,
      featuring: null,
      tags: [],
      comments: null,
      copyright: null,
      dateTaken: null,
      authors: null,
      contentPartner: null,
    };

    const title = this.cleanTextHelper(rawData.title);
    const captionText = rawData.caption ? rawData.caption.trim() : null;
    
    result.title = title;
    result.captionRaw = captionText;
    result.comments = captionText;

    // Extract content partner if available
    if (rawData.contentPartner) {
      result.contentPartner = this.cleanTextHelper(rawData.contentPartner);
    }

    // Extract keywords if available
    if (rawData.keywords && Array.isArray(rawData.keywords)) {
      result.tags = rawData.keywords.map((k: string) => this.cleanTextHelper(k)).filter(Boolean) as string[];
    }

    // Reduced logging for performance
    // console.log(`[DEBUG parseMetadata] Processing ${rawData.labelValues?.length || 0} label-value pairs`);
    
    for (const item of rawData.labelValues || []) {
      const label = item.label?.toLowerCase() || '';
      const value = this.cleanTextHelper(item.value);

      // Reduced logging for performance
      // console.log(`[DEBUG parseMetadata] Label: "${item.label}" -> "${label}" | Value: "${value?.substring(0, 50) || 'null'}"`);

      if (!value) continue;

      switch (label) {
        case 'photographer':
        case 'credit':
        case 'photo credit':
        case 'by':
        case 'author':
        case 'shot by':
        case 'photo by':
          result.photographer = result.photographer || value;
          result.authors = result.authors || value;
          if (value.includes('©') || value.includes('Copyright')) {
            result.copyright = result.copyright || value;
          }
          break;
        case 'image size':
        case 'size':
        case 'dimensions':
        case 'resolution':
          result.imageSize = result.imageSize || value;
          break;
        case 'file size':
        case 'filesize':
          result.fileSize = result.fileSize || value;
          break;
        case 'country':
        case 'nation':
          result.country = result.country || value;
          break;
        case 'city':
        case 'location':
        case 'place':
        case 'where':
          result.city = result.city || value;
          break;
        case 'date':
        case 'date taken':
        case 'when':
        case 'date created':
        case 'created':
          if (!result.date) {
            result.date = value;
            result.dateTaken = normalizeDate(value) || value;
          }
          break;
        case 'event':
        case 'title':
        case 'headline':
        case 'event title':
          result.title = result.title || value;
          result.matchEvent = result.matchEvent || value;
          break;
        case 'caption':
        case 'description':
        case 'desc':
          result.comments = result.comments || value;
          break;
        case 'featuring':
        case 'people':
        case 'subject':
        case 'subjects':
        case 'person':
        case 'who':
          result.featuring = result.featuring || value;
          break;
        case 'tags':
        case 'keywords':
        case 'keyword':
          if (value) {
            result.tags = value.split(/[,;]/).map(t => t.trim()).filter(Boolean);
          }
          break;
        case 'copyright':
        case '©':
        case 'rights':
          result.copyright = result.copyright || value;
          break;
        default:
          // Reduced logging for performance
          // console.log(`[DEBUG parseMetadata] UNMATCHED LABEL: "${label}" (value: "${value?.substring(0, 50)}")`);
          break;
      }
    }

    result.title = result.title || title;
    result.matchEvent = result.matchEvent || result.title || captionText;

    if (captionText) {
      // Parse multi-line caption text that contains embedded metadata
      const lines = captionText.split('\n').map(l => l.trim()).filter(Boolean);
      
      // Strategy 1: Look for credit/photographer markers (supports multiple formats)
      // Handles: "Credit:", "Photographer:", "©", "Copyright:", etc.
      const creditMatch = captionText.match(/(?:Credit|Photographer|Photo(?:\s+Credit)?|©|Copyright)(?:\s*\([^)]+\))?:\s*([^\n]+)/i);
      if (creditMatch) {
        const credit = this.cleanTextHelper(creditMatch[1]);
        if (credit) {
          let cleanedCredit = credit;
          
          // Remove "(Mandatory):" prefix and similar artifacts
          cleanedCredit = cleanedCredit.replace(/^\s*\([^)]+\)\s*:\s*/, '').trim();
          cleanedCredit = cleanedCredit.replace(/^:\s*/, '').trim();
          
          // NOTE: Preserving full credit including agency suffixes (e.g., "Ricky Swift/WENN.com")
          // Previously stripped provider suffixes, but user wants to keep them for comprehensive attribution
          
          // Validate cleaned credit is not empty before assigning
          if (cleanedCredit && cleanedCredit.length > 0) {
            result.photographer = result.photographer || cleanedCredit;
            result.authors = result.authors || cleanedCredit;
            result.copyright = result.copyright || cleanedCredit;
          }
        }
      }

      // Strategy 2: Look for location-date line format: "City, Country - DD.MM.YY"
      // This is common in SmartFrame captions (e.g., "Cardiff, Wales - 15.11.07")
      for (const line of lines) {
        // Relaxed regex: allows digits and hyphens in location, anchors to trailing date
        // Matches: "10 Downing Street, London – 12.03.21", "New York-New York, USA – 03.04.22"
        const locationDateMatch = line.match(/^(.+?)\s+[-–]\s+(\d{2}\.\d{2}\.\d{2,4})$/);
        if (locationDateMatch && !result.date) {
          const locationPart = locationDateMatch[1].trim();
          const datePart = locationDateMatch[2].trim();
          
          // Add heuristics to validate this looks like a location
          const looksLikeLocation = (() => {
            const lowerLocation = locationPart.toLowerCase();
            
            // Reject if contains common non-location words indicating narrative text
            const nonLocationWords = ['the', 'crew', 'team', 'squad', 'group', 'cast', 'staff', 'members', 'players', 'fans', 'crowd', 'audience'];
            if (nonLocationWords.some(word => lowerLocation.includes(` ${word} `) || lowerLocation.startsWith(`${word} `) || lowerLocation.endsWith(` ${word}`))) {
              return false;
            }
            
            // Accept if contains comma (typical for "City, Country" format)
            // This includes long locations like "Los Angeles Convention Center, Los Angeles, California, USA"
            if (locationPart.includes(',')) return true;
            
            // Accept if mostly capitalized words (typical of location names)
            const words = locationPart.split(/\s+/);
            const capitalizedWords = words.filter(word => /^[A-Z]/.test(word));
            if (capitalizedWords.length >= words.length * 0.5) return true;
            
            // Accept if contains location keywords
            const locationKeywords = ['street', 'avenue', 'road', 'boulevard', 'center', 'centre', 'stadium', 'arena', 'park', 'hall', 'square', 'building'];
            if (locationKeywords.some(keyword => lowerLocation.includes(keyword))) return true;
            
            // Otherwise reject
            return false;
          })();
          
          if (looksLikeLocation) {
            // Parse location (format: "City, Country" or just "City")
            if (locationPart.includes(',')) {
              const parts = locationPart.split(',').map(p => p.trim());
              result.city = result.city || this.cleanTextHelper(parts[0]);
              result.country = result.country || this.cleanTextHelper(parts.slice(1).join(', '));
            } else {
              result.city = result.city || this.cleanTextHelper(locationPart);
            }
            
            // Parse date
            result.date = datePart;
            result.dateTaken = normalizeDate(datePart) || datePart;
            
            console.log(`[Metadata] Extracted embedded location/date: ${locationPart} - ${datePart}`);
          } else {
            console.log(`[Metadata] Skipped non-location line: ${locationPart} - ${datePart}`);
          }
        }
      }

      // Strategy 3: Look for explicit "Where:" marker
      const whereMatch = captionText.match(/Where:\s*([^\n]+)/i);
      if (whereMatch) {
        const location = this.cleanTextHelper(whereMatch[1]);
        if (location) {
          if (location.includes(',')) {
            const parts = location.split(',').map((p: string) => p.trim());
            result.city = result.city || this.cleanTextHelper(parts[0]);
            result.country = result.country || this.cleanTextHelper(parts.slice(1).join(', '));
          } else {
            result.city = result.city || location;
          }
        }
      }

      // Strategy 4: Look for explicit "When:" marker
      const whenMatch = captionText.match(/When:\s*([^\n]+)/i);
      if (whenMatch && !result.date) {
        const dateValue = this.cleanTextHelper(whenMatch[1]);
        result.date = dateValue;
        result.dateTaken = normalizeDate(dateValue) || dateValue;
      }

      // Strategy 5: Extract title from first line if not already set
      // The first line is usually the actual caption/description
      if (!result.title && lines.length > 0) {
        // Helper to check if a line is a provider/collection slug
        const isProviderSlug = (text: string): boolean => {
          const knownProviders = [
            /^(WENN|Getty|AFP|Reuters|AP|Press Association|PA|Shutterstock|Alamy|Corbis)$/i,
            /^(WireImage|FilmMagic|GC Images|Splash News|DPA|EPA|Xinhua|Sipa)$/i,
          ];
          
          // Check against known provider patterns
          if (knownProviders.some(pattern => pattern.test(text.trim()))) {
            return true;
          }
          
          // Check if it's a short all-caps slug (1-3 words, typically provider codes)
          const words = text.trim().split(/\s+/);
          if (words.length <= 3 && text === text.toUpperCase() && /^[A-Z]/.test(text)) {
            return true;
          }
          
          return false;
        };
        
        let titleLine = lines[0];
        let titleIndex = 0;
        
        // Skip provider slugs and find first actual descriptive line
        while (titleIndex < lines.length) {
          titleLine = lines[titleIndex];
          
          // Skip metadata lines
          if (titleLine.includes('Credit:') || 
              titleLine.includes('Where:') || 
              titleLine.includes('When:') ||
              titleLine.match(/^.+?\s+[-–]\s+\d{2}\.\d{2}/)) {
            titleIndex++;
            continue;
          }
          
          // Skip provider slugs
          if (isProviderSlug(titleLine)) {
            titleIndex++;
            continue;
          }
          
          // Found a good title line
          break;
        }
        
        // Use the found line if it's valid
        if (titleIndex < lines.length && titleLine) {
          const cleanedTitleLine = this.cleanTextHelper(titleLine);
          if (cleanedTitleLine) {
            result.title = cleanedTitleLine;
          }
        }
      }
      
      // FIX Issue 3: Final fallback only if we haven't set title through descriptive line selection
      // This preserves the curated descriptive line and only falls back when truly necessary
      if (!result.title) {
        result.title = result.matchEvent || result.captionRaw;
      }

      // Strategy 6: Look for "Featuring:" marker
      const featuringMatch = captionText.match(/Featuring:\s*([^\n]+)/i);
      if (featuringMatch) {
        result.featuring = result.featuring || this.cleanTextHelper(featuringMatch[1]);
      }
    }

    if (rawData.nextData) {
      result.photographer = result.photographer || this.cleanTextHelper(rawData.nextData.photographer);
      result.authors = result.authors || result.photographer;
      result.imageSize = result.imageSize || this.cleanTextHelper(rawData.nextData.dimensions);
      result.fileSize = result.fileSize || this.cleanTextHelper(rawData.nextData.fileSize);
      result.country = result.country || this.cleanTextHelper(rawData.nextData.country);
      result.city = result.city || this.cleanTextHelper(rawData.nextData.city);
      
      if (!result.date) {
        const dateValue = this.cleanTextHelper(rawData.nextData.date);
        result.date = dateValue;
        result.dateTaken = normalizeDate(dateValue) || dateValue;
      }
      
      result.title = result.title || this.cleanTextHelper(rawData.nextData.title || rawData.nextData.eventTitle);
      result.matchEvent = result.matchEvent || result.title;
      result.featuring = result.featuring || this.cleanTextHelper(rawData.nextData.featuring || rawData.nextData.people);
      result.copyright = result.copyright || this.cleanTextHelper(rawData.nextData.copyright);
      result.contentPartner = result.contentPartner || this.cleanTextHelper(rawData.nextData.contentPartner || rawData.nextData.provider);
      
      if (rawData.nextData.tags && Array.isArray(rawData.nextData.tags)) {
        result.tags = [...new Set([...(result.tags || []), ...rawData.nextData.tags.map((t: any) => String(t).trim()).filter(Boolean)])];
      }
    }

    // Final fallback: if date is set but dateTaken is not, normalize it
    if (result.date && !result.dateTaken) {
      result.dateTaken = normalizeDate(result.date) || result.date;
    }

    // Generate composite caption from all available metadata
    result.caption = generateCaption({
      title: result.title,
      captionRaw: result.captionRaw,
      featuring: result.featuring,
      city: result.city,
      country: result.country,
      dateTaken: result.dateTaken,
      photographer: result.photographer,
      copyright: result.copyright,
    });

    return result;
  }

  private async extractImageData(
    page: Page,
    url: string,
    imageId: string,
    hash: string,
    extractDetails: boolean,
    thumbnailUrl?: string
  ): Promise<ScrapedImage | null> {
    const image: ScrapedImage = {
      imageId,
      hash,
      url,
      copyLink: url,
      smartframeId: imageId,
      photographer: null,
      imageSize: null,
      fileSize: null,
      country: null,
      city: null,
      date: null,
      matchEvent: null,
      thumbnailUrl: thumbnailUrl || null,
      title: null,
      caption: null,
      captionRaw: null,
      featuring: null,
      tags: [],
      comments: null,
      copyright: null,
      dateTaken: null,
      authors: null,
      contentPartner: null,
    };

    // Check if we have cached metadata from network interception (Strategy A)
    if (metadataCache.has(imageId)) {
      const cachedData = metadataCache.get(imageId);
      console.log(`Using cached network metadata for ${imageId}`);
      
      // Map cached data to image fields (legacy fields)
      image.photographer = cachedData.photographer || cachedData.credit || cachedData.author || null;
      image.imageSize = cachedData.dimensions || cachedData.size || cachedData.imageSize || null;
      image.fileSize = cachedData.fileSize || cachedData.file_size || null;
      image.country = cachedData.country || cachedData.location?.country || null;
      image.city = cachedData.city || cachedData.location?.city || null;
      image.date = cachedData.date || cachedData.dateCreated || cachedData.created_at || null;
      image.matchEvent = cachedData.title || cachedData.event || cachedData.description || null;
      
      // Map cached data to new IPTC/EXIF fields
      image.title = cachedData.title || cachedData.headline || null;
      image.captionRaw = cachedData.description || cachedData.caption || null;
      image.featuring = cachedData.featuring || cachedData.people || cachedData.subject || null;
      image.comments = image.captionRaw;
      image.copyright = cachedData.copyright || cachedData.credit || null;
      image.authors = image.photographer;
      
      if (cachedData.tags && Array.isArray(cachedData.tags)) {
        image.tags = cachedData.tags.map((t: any) => String(t).trim()).filter(Boolean);
      }
      
      // Normalize date if available
      if (image.date) {
        image.dateTaken = normalizeDate(image.date);
      }
    }

    if (extractDetails) {
      try {
        // Set viewport to desktop size to ensure lg:block elements are visible
        await page.setViewport({ width: 1280, height: 800 });
        
        // Retry mechanism for page navigation with HTTP status code checking
        let navSuccess = false;
        let httpStatus = 0;
        let lastError: Error | null = null;
        const maxAttempts = 3;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            // Use networkidle2 to ensure all JavaScript and content has loaded
            // This is critical for SmartFrame pages that load metadata dynamically
            const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
            httpStatus = response?.status() || 0;
            
            // Check for HTTP error responses
            if (httpStatus >= 500) {
              console.log(`⚠️  [${imageId}] HTTP ${httpStatus} error - Server error (attempt ${attempt}/${maxAttempts})`);
              if (attempt < maxAttempts) {
                // Exponential backoff: 2s, 4s, 8s
                const delay = 2000 * Math.pow(2, attempt - 1);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
              } else {
                console.log(`❌ [${imageId}] Failed after ${attempt} attempts - HTTP ${httpStatus}. Logging failure.`);
                failedScrapesLogger.addFailure({
                  imageId,
                  url,
                  reason: `HTTP ${httpStatus} Server Error after ${maxAttempts} attempts`,
                  attempts: maxAttempts,
                  timestamp: new Date().toISOString(),
                  httpStatus
                });
                return image; // Return partial data for CSV
              }
            } else if (httpStatus === 404) {
              console.log(`❌ [${imageId}] HTTP 404 - Image not found. Logging failure.`);
              failedScrapesLogger.addFailure({
                imageId,
                url,
                reason: 'HTTP 404 - Image Not Found',
                attempts: attempt,
                timestamp: new Date().toISOString(),
                httpStatus
              });
              return image; // Return partial data for CSV
            } else if (httpStatus >= 400) {
              console.log(`⚠️  [${imageId}] HTTP ${httpStatus} error - Client error. Logging failure.`);
              failedScrapesLogger.addFailure({
                imageId,
                url,
                reason: `HTTP ${httpStatus} Client Error`,
                attempts: attempt,
                timestamp: new Date().toISOString(),
                httpStatus
              });
              return image; // Return partial data for CSV
            }
            
            navSuccess = true;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.log(`Navigation attempt ${attempt} failed for ${url}:`, error instanceof Error ? error.message : error);
            if (attempt === maxAttempts) {
              // Log navigation timeout failure
              console.log(`❌ [${imageId}] Failed to navigate after ${maxAttempts} attempts. Logging failure.`);
              failedScrapesLogger.addFailure({
                imageId,
                url,
                reason: `Navigation timeout: ${lastError.message}`,
                attempts: maxAttempts,
                timestamp: new Date().toISOString()
              });
              return image; // Return partial data for CSV
            }
            // Exponential backoff: 2s, 4s, 8s
            const delay = 2000 * Math.pow(2, attempt - 1);
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        if (!navSuccess) return image; // Return partial data for CSV

        // CRITICAL: Wait for dynamic content to fully load
        // SmartFrame uses JavaScript to populate metadata after initial page load
        console.log(`[${imageId}] Waiting for dynamic content to load...`);
        
        // Wait for smartframe-embed element (metadata container) - reduced timeout
        try {
          await page.waitForSelector('smartframe-embed', { timeout: 5000 });
          console.log(`[${imageId}] smartframe-embed found`);
        } catch (error) {
          // Not found - will try extraction anyway
        }

        // Smart wait: Check if metadata is ready, or wait briefly
        // This replaces the fixed 3-second delay with a conditional check
        try {
          await page.waitForFunction(() => {
            // Check for various metadata indicators
            const scripts = Array.from(document.querySelectorAll('script'));
            const hasNextData = scripts.some(s => s.id === '__NEXT_DATA__' || s.textContent?.includes('props'));
            const hasMetadata = scripts.some(s => s.textContent?.includes('photographer') || s.textContent?.includes('metadata'));
            const hasShadowContent = document.querySelector('smartframe-embed')?.shadowRoot?.querySelector('li') !== null;
            
            return hasNextData || hasMetadata || hasShadowContent;
          }, { timeout: 3000 });  // Reduced from 10s to 3s
        } catch (error) {
          // Metadata not confirmed within timeout - proceed anyway
          // Add a minimal 500ms safety buffer
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // CRITICAL FIX: SmartFrame renders metadata INSIDE shadow DOM
        // We must access smartframe-embed.shadowRoot, not document
        const rawData = await page.evaluate(() => {
          const labelValues: Array<{ label: string; value: string }> = [];
          const keywords: string[] = [];
          
          // Find smartframe-embed element
          const embed = document.querySelector('smartframe-embed');
          let shadowRoot = null;
          
          if (embed) {
            shadowRoot = embed.shadowRoot;
            if (!shadowRoot) {
              console.log('[Extraction] smartframe-embed found but shadowRoot is null');
            } else {
              console.log('[Extraction] smartframe-embed shadowRoot accessed successfully');
            }
          } else {
            console.log('[Extraction] smartframe-embed element not found');
          }

          // Extract from BOTH shadow DOM and light DOM for maximum coverage
          let title = null;
          let caption = null;
          let contentPartner = null;

          // Try shadow DOM first (where SmartFrame metadata actually lives)
          if (shadowRoot) {
            const shadowTitle = shadowRoot.querySelector('h1, h2, [class*="title"], [data-title]');
            title = shadowTitle?.textContent || null;
            
            const shadowCaption = shadowRoot.querySelector('p, div[class*="caption"], [class*="description"]');
            caption = shadowCaption?.textContent || null;
            
            // Extract label-value pairs from shadow DOM
            shadowRoot.querySelectorAll('li').forEach(li => {
              const strong = li.querySelector('strong');
              if (!strong) return;
              
              const label = strong.textContent?.replace(':', '').trim() || '';
              let value: string | null = null;
              
              const button = li.querySelector('button');
              if (button) {
                value = button.textContent || null;
              } else if (strong.nextSibling) {
                value = strong.nextSibling.textContent || null;
              }
              
              if (label && value) {
                labelValues.push({ label, value });
                console.log(`[Extraction Shadow] Found: ${label} = ${value.substring(0, 50)}`);
              }
            });
          }

          // Fallback: try light DOM (page-level metadata)
          // IMPORTANT: Skip provider/gallery name (h2) - it's not the image title
          if (!title) {
            // Try h1 first (actual title), skip h2 (usually just the provider name like "WENN")
            const h1El = document.querySelector('h1');
            if (h1El?.textContent && !h1El.textContent.match(/^(WENN|Getty|AFP|Reuters|Shutterstock)$/i)) {
              title = h1El.textContent;
            }
          }
          
          if (!caption) {
            // Look for the main paragraph that contains the full caption with embedded metadata
            // This usually has the format:
            // [Title/description]
            // [Location] - [Date]
            // Credit: [Photographer]
            const captionSelectors = [
              'section p', // Main caption paragraph in section
              'p.text-iy-midnight-400',
              'div.text-iy-midnight-400',
              'p[class*="midnight"]',
              'p[class*="caption"]',
              'article p',
              'main p'
            ];
            
            for (const selector of captionSelectors) {
              const el = document.querySelector(selector);
              if (el?.textContent && el.textContent.length > 20) { // Ensure it's substantial content
                const text = el.textContent.trim();
                // Verify it contains actual metadata (not just UI text)
                if (text.includes('Credit:') || text.match(/\d{2}\.\d{2}\.\d{2}/) || text.includes(' - ')) {
                  caption = text;
                  console.log('[Extraction Light] Found caption paragraph with embedded metadata');
                  break;
                }
              }
            }
          }

          // Extract SmartFrame Content Partner
          // Look for the pattern: <h6>SmartFrame Content Partner</h6><h2>Provider Name</h2>
          const contentPartnerSection = document.querySelector('h6.headline');
          if (contentPartnerSection?.textContent?.includes('SmartFrame Content Partner')) {
            // Get the next h2 sibling or the h2 within the same parent
            const parent = contentPartnerSection.parentElement;
            const partnerName = parent?.querySelector('h2.headline');
            if (partnerName?.textContent) {
              contentPartner = partnerName.textContent.trim();
              console.log(`[Extraction] Found Content Partner: ${contentPartner}`);
            }
          }

          // Extract Keywords from button elements
          // Keywords are displayed as buttons with the keyword text
          const keywordSection = document.querySelector('h2');
          const keywordSections = Array.from(document.querySelectorAll('h2')).filter(h2 => 
            h2.textContent?.toLowerCase().includes('keywords') || h2.textContent?.toLowerCase().includes('keyword')
          );
          
          if (keywordSections.length > 0) {
            // Find the parent section and get all button elements within it
            keywordSections.forEach(section => {
              const parent = section.parentElement;
              if (parent) {
                const buttons = parent.querySelectorAll('button[type="button"]');
                buttons.forEach(button => {
                  const keyword = button.textContent?.trim();
                  if (keyword && keyword.length > 0 && !keyword.includes('SmartFrame') && !keyword.includes('View all')) {
                    keywords.push(keyword);
                  }
                });
              }
            });
            console.log(`[Extraction] Found ${keywords.length} keywords`);
          }

          // Extract label-value pairs from light DOM as fallback
          document.querySelectorAll('li').forEach(li => {
            const strong = li.querySelector('strong');
            if (!strong) return;
            
            const label = strong.textContent?.replace(':', '').trim() || '';
            
            // Skip if we already have this label from shadow DOM
            if (labelValues.some(lv => lv.label.toLowerCase() === label.toLowerCase())) {
              return;
            }
            
            let value: string | null = null;
            const button = li.querySelector('button');
            if (button) {
              value = button.textContent || null;
            } else if (strong.nextSibling) {
              value = strong.nextSibling.textContent || null;
            }
            
            if (label && value) {
              labelValues.push({ label, value });
              console.log(`[Extraction Light] Found: ${label} = ${value.substring(0, 50)}`);
            }
          });

          // COMPREHENSIVE JSON EXTRACTION
          // SmartFrame embeds metadata as JSON in various formats
          // We try multiple strategies to find and extract this data
          let nextData: any = null;
          const extractionLog: string[] = [];

          // Strategy 1: __NEXT_DATA__ script tag (Next.js standard)
          try {
            const nextDataScript = document.querySelector('script#__NEXT_DATA__');
            if (nextDataScript?.textContent) {
              extractionLog.push('Found __NEXT_DATA__ script');
              const parsed = JSON.parse(nextDataScript.textContent);
              
              // Try multiple possible paths in the JSON structure
              const possiblePaths = [
                parsed?.props?.pageProps?.image?.metadata,
                parsed?.props?.pageProps?.metadata,
                parsed?.props?.pageProps?.image,
                parsed?.props?.image?.metadata,
                parsed?.pageProps?.image?.metadata,
              ];
              
              for (const imageMetadata of possiblePaths) {
                if (imageMetadata && typeof imageMetadata === 'object') {
                  extractionLog.push(`Found metadata at path in __NEXT_DATA__`);
                  nextData = {
                    photographer: imageMetadata.photographer || imageMetadata.credit || imageMetadata.byline || imageMetadata.author,
                    dimensions: imageMetadata.dimensions || imageMetadata.imageSize || imageMetadata.size,
                    fileSize: imageMetadata.fileSize || imageMetadata.file_size,
                    country: imageMetadata.country || imageMetadata.countryCode,
                    city: imageMetadata.city || imageMetadata.location,
                    date: imageMetadata.date || imageMetadata.dateCreated || imageMetadata.dateTaken || imageMetadata.created,
                    eventTitle: imageMetadata.eventTitle || imageMetadata.event || imageMetadata.matchEvent,
                    title: imageMetadata.title || imageMetadata.headline || imageMetadata.name,
                    caption: imageMetadata.caption || imageMetadata.description,
                    featuring: imageMetadata.featuring || imageMetadata.people || imageMetadata.subject,
                    people: imageMetadata.people || imageMetadata.featuring,
                    tags: imageMetadata.tags || imageMetadata.keywords || imageMetadata.categories || [],
                    copyright: imageMetadata.copyright || imageMetadata.copyrightNotice,
                    credit: imageMetadata.credit || imageMetadata.photographer,
                    comments: imageMetadata.comments || imageMetadata.notes,
                    authors: imageMetadata.authors || imageMetadata.author || imageMetadata.photographer
                  };
                  break;
                }
              }
            }
          } catch (e) {
            extractionLog.push(`__NEXT_DATA__ parse error: ${e}`);
          }

          // Strategy 2: Search all script tags for JSON containing metadata
          if (!nextData) {
            try {
              const scripts = Array.from(document.querySelectorAll('script'));
              extractionLog.push(`Searching ${scripts.length} script tags for JSON metadata`);
              
              for (const script of scripts) {
                if (!script.textContent) continue;
                const content = script.textContent;
                
                // Skip very small scripts
                if (content.length < 100) continue;
                
                // Look for JSON-like content with metadata keywords
                if (content.includes('photographer') || 
                    content.includes('metadata') || 
                    content.includes('caption') ||
                    content.includes('copyright')) {
                  
                  // Try to parse as JSON
                  try {
                    // Handle various JSON formats
                    let jsonData = null;
                    
                    // Direct JSON
                    if (content.trim().startsWith('{')) {
                      jsonData = JSON.parse(content);
                    }
                    // JSON.parse("...") wrapped
                    else if (content.includes('JSON.parse')) {
                      const match = content.match(/JSON\.parse\(['"](.+)['"]\)/);
                      if (match) {
                        // Unescape the JSON string
                        const unescaped = match[1]
                          .replace(/\\"/g, '"')
                          .replace(/\\'/g, "'")
                          .replace(/\\\\/g, '\\')
                          .replace(/\\n/g, '\n')
                          .replace(/\\r/g, '\r')
                          .replace(/\\t/g, '\t');
                        jsonData = JSON.parse(unescaped);
                      }
                    }
                    // Embedded in object/array
                    else {
                      // Try to extract JSON object/array
                      const jsonMatch = content.match(/\{[\s\S]*"photographer"[\s\S]*\}/);
                      if (jsonMatch) {
                        jsonData = JSON.parse(jsonMatch[0]);
                      }
                    }
                    
                    if (jsonData) {
                      extractionLog.push(`Found JSON with metadata keywords`);
                      
                      // Recursively search for metadata object
                      const findMetadata = (obj: any): any => {
                        if (!obj || typeof obj !== 'object') return null;
                        
                        // Check if this object looks like metadata
                        if ((obj.photographer || obj.credit) && (obj.title || obj.caption)) {
                          return obj;
                        }
                        
                        // Check nested properties
                        for (const key of Object.keys(obj)) {
                          if (key === 'metadata' || key === 'image' || key === 'imageData') {
                            const nested = findMetadata(obj[key]);
                            if (nested) return nested;
                          }
                        }
                        
                        // Check arrays
                        if (Array.isArray(obj)) {
                          for (const item of obj) {
                            const nested = findMetadata(item);
                            if (nested) return nested;
                          }
                        }
                        
                        return null;
                      };
                      
                      const metadata = findMetadata(jsonData);
                      if (metadata) {
                        extractionLog.push(`Extracted metadata from embedded JSON`);
                        nextData = {
                          photographer: metadata.photographer || metadata.credit || metadata.byline,
                          dimensions: metadata.dimensions || metadata.imageSize || metadata.size,
                          fileSize: metadata.fileSize || metadata.file_size,
                          country: metadata.country,
                          city: metadata.city,
                          date: metadata.date || metadata.dateCreated || metadata.dateTaken,
                          eventTitle: metadata.eventTitle || metadata.event,
                          title: metadata.title || metadata.headline,
                          caption: metadata.caption || metadata.description,
                          featuring: metadata.featuring || metadata.people,
                          people: metadata.people,
                          tags: metadata.tags || metadata.keywords || [],
                          copyright: metadata.copyright,
                          credit: metadata.credit,
                          comments: metadata.comments,
                          authors: metadata.authors || metadata.author || metadata.photographer
                        };
                        break;
                      }
                    }
                  } catch (e) {
                    // Continue to next script
                  }
                }
              }
            } catch (e) {
              extractionLog.push(`Script search error: ${e}`);
            }
          }

          extractionLog.forEach(log => console.log(`[Extraction] ${log}`));
          return { title, caption, labelValues, nextData, contentPartner, keywords };
        });

        // Reduced logging for performance - uncomment for debugging
        // console.log(`[DEBUG] Extracted raw data for ${url}:`, {
        //   title: rawData.title,
        //   caption: rawData.caption?.substring(0, 100),
        //   labelCount: rawData.labelValues?.length,
        //   hasNextData: !!rawData.nextData
        // });

        // Detect error pages by checking the title and content
        const errorPageIndicators = [
          '502 bad gateway',
          '503 service unavailable',
          '500 internal server error',
          '504 gateway timeout',
          '429 too many requests',
          'error occurred',
          'page not found',
          'access denied',
          'rate limit exceeded'
        ];
        
        const titleLower = (rawData.title || '').toLowerCase().trim();
        const isErrorPage = errorPageIndicators.some(indicator => titleLower.includes(indicator));
        
        if (isErrorPage) {
          console.log(`❌ [${imageId}] Error page detected (title: "${rawData.title}"). SmartFrame may be rate-limiting or experiencing issues.`);
          console.log(`⚠️  [${imageId}] Logging failure and returning partial data for CSV.`);
          failedScrapesLogger.addFailure({
            imageId,
            url,
            reason: `Error page detected: ${rawData.title}`,
            attempts: 1,
            timestamp: new Date().toISOString()
          });
          return image; // Return partial data for CSV
        }
        
        // If we have 0 label-value pairs AND no useful title/caption, it's likely an error
        const hasNoMetadata = (!rawData.labelValues || rawData.labelValues.length === 0) && 
                             !rawData.nextData && 
                             (!rawData.title || rawData.title.length < 3) &&
                             (!rawData.caption || rawData.caption.length < 10);
        
        if (hasNoMetadata) {
          console.log(`⚠️  [${imageId}] No metadata found on page - possible error or rate limiting. Logging failure.`);
          failedScrapesLogger.addFailure({
            imageId,
            url,
            reason: 'No metadata found - possible rate limiting or error page',
            attempts: 1,
            timestamp: new Date().toISOString()
          });
          return image; // Return partial data for CSV
        }

        // Process raw data in Node context using helper functions
        const metadata = this.parseMetadata(rawData);
        
        // Reduced logging for performance - uncomment for debugging
        // console.log(`[DEBUG] Parsed metadata for ${url}:`, {
        //   photographer: metadata.photographer,
        //   title: metadata.title,
        //   featuring: metadata.featuring,
        //   date: metadata.date,
        //   dateTaken: metadata.dateTaken
        // });

        // Merge DOM-extracted data (DOM takes priority over network cache for accuracy)
        image.photographer = metadata.photographer ?? image.photographer;
        image.imageSize = metadata.imageSize ?? image.imageSize;
        image.fileSize = metadata.fileSize ?? image.fileSize;
        image.country = metadata.country ?? image.country;
        image.city = metadata.city ?? image.city;
        image.date = metadata.date ?? image.date;
        image.matchEvent = metadata.matchEvent ?? image.matchEvent;
        
        image.title = metadata.title ?? image.title;
        image.caption = metadata.caption ?? image.caption;
        image.captionRaw = metadata.captionRaw ?? image.captionRaw;
        image.featuring = metadata.featuring ?? image.featuring;
        image.tags = (metadata.tags && metadata.tags.length > 0) ? metadata.tags : image.tags;
        image.comments = metadata.comments ?? image.comments;
        image.copyright = metadata.copyright ?? image.copyright;
        image.dateTaken = metadata.dateTaken ?? image.dateTaken;
        image.authors = metadata.authors ?? image.authors;
        image.contentPartner = metadata.contentPartner ?? image.contentPartner;

      } catch (error) {
        console.error(`Error extracting details for ${url}:`, error);
        // Log the failure from generic extraction error
        failedScrapesLogger.addFailure({
          imageId,
          url,
          reason: `Detail extraction error: ${error instanceof Error ? error.message : String(error)}`,
          attempts: 1,
          timestamp: new Date().toISOString()
        });
      }
    }

    return image;
  }
}

export const scraper = new SmartFrameScraper();
