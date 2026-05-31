package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gocolly/colly/v2"
	"github.com/joho/godotenv"
)

type CrawlerManager struct {
	visitedURLs    sync.Map
	redirectCounts sync.Map
	activeGoroutines int64
	maxRedirects    int
	requestTimeout  time.Duration
}

func NewCrawlerManager(maxRedirects int, timeout time.Duration) *CrawlerManager {
	return &CrawlerManager{
		maxRedirects:   maxRedirects,
		requestTimeout: timeout,
	}
}

func (cm *CrawlerManager) IsVisited(url string) bool {
	_, exists := cm.visitedURLs.LoadOrStore(url, true)
	return exists
}

func (cm *CrawlerManager) CheckRedirectLoop(url string) bool {
	count, _ := cm.redirectCounts.LoadOrStore(url, 0)
	currentCount := count.(int) + 1
	cm.redirectCounts.Store(url, currentCount)
	return currentCount > cm.maxRedirects
}

func (cm *CrawlerManager) IncrementGoroutine() {
	atomic.AddInt64(&cm.activeGoroutines, 1)
}

func (cm *CrawlerManager) DecrementGoroutine() {
	atomic.AddInt64(&cm.activeGoroutines, -1)
}

func (cm *CrawlerManager) GetActiveGoroutines() int64 {
	return atomic.LoadInt64(&cm.activeGoroutines)
}

func main() {
	_ = godotenv.Load()

	neo4jURI := getEnv("NEO4J_URI", "bolt://localhost:7687")
	neo4jUser := getEnv("NEO4J_USER", "neo4j")
	neo4jPassword := getEnv("NEO4J_PASSWORD", "password")
	startURL := getEnv("CRAWLER_START_URL", "https://pkg.go.dev/std")
	maxDepth, _ := strconv.Atoi(getEnv("CRAWLER_MAX_DEPTH", "3"))
	concurrency, _ := strconv.Atoi(getEnv("CRAWLER_CONCURRENCY", "5"))
	maxRedirects, _ := strconv.Atoi(getEnv("CRAWLER_MAX_REDIRECTS", "5"))
	timeoutSeconds, _ := strconv.Atoi(getEnv("CRAWLER_TIMEOUT", "30"))

	cm := NewCrawlerManager(maxRedirects, time.Duration(timeoutSeconds)*time.Second)

	store, err := NewNeo4jStore(neo4jURI, neo4jUser, neo4jPassword)
	if err != nil {
		log.Fatalf("Failed to connect to Neo4j: %v", err)
	}
	defer store.Close()

	c := colly.NewCollector(
		colly.MaxDepth(maxDepth),
		colly.Async(true),
		colly.UserAgent("TechDocCrawler/1.0"),
		colly.AllowURLRevisit(),
	)

	c.WithTransport(&http.Transport{
		MaxIdleConns:        100,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		DisableKeepAlives:   false,
	})

	c.SetRequestTimeout(cm.requestTimeout)

	c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: concurrency,
		RandomDelay: 500 * time.Millisecond,
	})

	extractor := NewTechTermExtractor()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				active := cm.GetActiveGoroutines()
				log.Printf("Status: Active goroutines=%d", active)
				if active == 0 {
					cancel()
				}
			}
		}
	}()

	c.OnHTML("body", func(e *colly.HTMLElement) {
		cm.IncrementGoroutine()
		defer cm.DecrementGoroutine()

		url := e.Request.URL.String()

		if cm.IsVisited(url) {
			return
		}

		title := e.ChildText("title")
		content := e.Text

		terms := extractor.ExtractTerms(content, title)

		doc := &TechDocument{
			URL:         url,
			Title:       title,
			Content:     content,
			TechTerms:   terms,
			References:  []string{},
		}

		e.ForEach("a[href]", func(_ int, link *colly.HTMLElement) {
			href := link.Attr("href")
			absURL := e.Request.AbsoluteURL(href)
			if absURL != "" && strings.HasPrefix(absURL, "http") && !cm.IsVisited(absURL) {
				if !cm.CheckRedirectLoop(absURL) {
					doc.References = append(doc.References, absURL)
				}
			}
		})

		if err := store.SaveDocument(doc); err != nil {
			log.Printf("Failed to save document %s: %v", url, err)
		} else {
			log.Printf("Saved: %s (%d terms, %d references)", title, len(terms), len(doc.References))
		}
	})

	c.OnRequest(func(r *colly.Request) {
		cm.IncrementGoroutine()
		url := r.URL.String()
		log.Println("Visiting:", url)

		if cm.CheckRedirectLoop(url) {
			log.Printf("Redirect loop detected for %s, aborting", url)
			r.Abort()
			cm.DecrementGoroutine()
			return
		}
	})

	c.OnResponse(func(r *colly.Response) {
		cm.DecrementGoroutine()
	})

	c.OnError(func(r *colly.Response, err error) {
		cm.DecrementGoroutine()
		if r != nil && r.Request != nil {
			log.Printf("Error on %s: %v", r.Request.URL, err)
		} else {
			log.Printf("Error: %v", err)
		}
	})

	c.OnScraped(func(r *colly.Response) {
		cm.DecrementGoroutine()
	})

	c.OnRedirect(func(request *http.Request, via []*http.Request) error {
		if len(via) >= cm.maxRedirects {
			log.Printf("Too many redirects (%d) for %s", len(via), request.URL)
			return http.ErrUseLastResponse
		}
		return nil
	})

	if err := c.Visit(startURL); err != nil {
		log.Fatalf("Failed to start crawling: %v", err)
	}

	c.Wait()

	log.Println("Waiting for all goroutines to finish...")
	for {
		active := cm.GetActiveGoroutines()
		if active <= 0 {
			break
		}
		log.Printf("Waiting for %d goroutines to finish...", active)
		time.Sleep(2 * time.Second)
	}

	log.Println("Crawling completed!")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
