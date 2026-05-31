package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/schollz/progressbar/v3"
	"github.com/urfave/cli/v2"
)

type CompressRequest struct {
	Data string `json:"data"`
}

type CompressResponse struct {
	Success        bool   `json:"success"`
	OriginalSize   int    `json:"originalSize"`
	CompressedSize int    `json:"compressedSize"`
	Ratio          string `json:"ratio"`
	DurationMs     int    `json:"durationMs"`
	Compressed     string `json:"compressed"`
}

type DecompressResponse struct {
	Success          bool   `json:"success"`
	CompressedSize   int    `json:"compressedSize"`
	DecompressedSize int    `json:"decompressedSize"`
	DurationMs       int    `json:"durationMs"`
	Decompressed     string `json:"decompressed"`
}

type BenchmarkResponse struct {
	Success         bool          `json:"success"`
	TestDataSizeMB  int           `json:"testDataSizeMB"`
	Timestamp       string        `json:"timestamp"`
	Compressions    []interface{} `json:"compressions"`
	Decompressions  []interface{} `json:"decompressions"`
	Comparison      interface{}   `json:"comparison"`
}

type FileResult struct {
	Path           string
	OriginalSize   int64
	CompressedSize int64
	Ratio          float64
	Duration       time.Duration
	Error          error
}

var (
	apiBaseURL = "http://localhost:3000"
	client     = &http.Client{
		Timeout: 5 * time.Minute,
	}
)

func main() {
	app := &cli.App{
		Name:  "lz4-cli",
		Usage: "LZ4 compression CLI tool for bulk file and folder compression",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "api",
				Aliases: []string{"a"},
				Value:   "http://localhost:3000",
				Usage:   "Compression API endpoint",
			},
		},
		Commands: []*cli.Command{
			{
				Name:    "compress",
				Aliases: []string{"c"},
				Usage:   "Compress files or folders",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "output",
						Aliases: []string{"o"},
						Value:   "compressed",
						Usage:   "Output directory or file",
					},
					&cli.BoolFlag{
						Name:    "recursive",
						Aliases: []string{"r"},
						Value:   false,
						Usage:   "Recursively compress directories",
					},
					&cli.IntFlag{
						Name:    "workers",
						Aliases: []string{"w"},
						Value:   4,
						Usage:   "Number of parallel workers",
					},
					&cli.StringFlag{
						Name:    "pattern",
						Aliases: []string{"p"},
						Value:   "*",
						Usage:   "File pattern to match",
					},
					&cli.BoolFlag{
						Name:    "tar",
						Aliases: []string{"t"},
						Value:   false,
						Usage:   "Create tar archive before compression",
					},
				},
				Action: func(c *cli.Context) error {
					apiBaseURL = c.String("api")
					return compressCommand(c)
				},
			},
			{
				Name:    "decompress",
				Aliases: []string{"d"},
				Usage:   "Decompress files",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:    "output",
						Aliases: []string{"o"},
						Value:   "decompressed",
						Usage:   "Output directory",
					},
					&cli.BoolFlag{
						Name:  "untar",
						Value: false,
						Usage: "Extract tar archive after decompression",
					},
				},
				Action: func(c *cli.Context) error {
					apiBaseURL = c.String("api")
					return decompressCommand(c)
				},
			},
			{
				Name:    "benchmark",
				Aliases: []string{"b"},
				Usage:   "Run performance benchmark",
				Flags: []cli.Flag{
					&cli.IntFlag{
						Name:    "size",
						Aliases: []string{"s"},
						Value:   1,
						Usage:   "Test data size in MB",
					},
				},
				Action: func(c *cli.Context) error {
					apiBaseURL = c.String("api")
					return benchmarkCommand(c)
				},
			},
			{
				Name:  "health",
				Usage: "Check API health",
				Action: func(c *cli.Context) error {
					apiBaseURL = c.String("api")
					return healthCommand(c)
				},
			},
		},
	}

	err := app.Run(os.Args)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}

func compressCommand(c *cli.Context) error {
	if c.NArg() == 0 {
		return fmt.Errorf("please specify files or directories to compress")
	}

	outputDir := c.String("output")
	recursive := c.Bool("recursive")
	workers := c.Int("workers")
	pattern := c.String("pattern")
	useTar := c.Bool("tar")

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	var files []string
	for _, path := range c.Args().Slice() {
		info, err := os.Stat(path)
		if err != nil {
			fmt.Printf("Warning: %v\n", err)
			continue
		}

		if info.IsDir() {
			if useTar {
				tarFile := filepath.Join(outputDir, filepath.Base(path)+".tar")
				if err := createTar(path, tarFile, recursive, pattern); err != nil {
					fmt.Printf("Error creating tar: %v\n", err)
					continue
				}
				files = append(files, tarFile)
			} else {
				dirFiles, err := findFiles(path, recursive, pattern)
				if err != nil {
					fmt.Printf("Error finding files: %v\n", err)
					continue
				}
				files = append(files, dirFiles...)
			}
		} else {
			matched, _ := filepath.Match(pattern, filepath.Base(path))
			if matched {
				files = append(files, path)
			}
		}
	}

	if len(files) == 0 {
		return fmt.Errorf("no files to compress")
	}

	fmt.Printf("Compressing %d files with %d workers...\n", len(files), workers)

	bar := progressbar.Default(int64(len(files)), "Compressing")
	results := make(chan FileResult, len(files))
	sem := make(chan struct{}, workers)
	var wg sync.WaitGroup

	for _, file := range files {
		wg.Add(1)
		go func(f string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := compressFile(f, outputDir)
			results <- result
			bar.Add(1)
		}(file)
	}

	wg.Wait()
	close(results)

	var totalOriginal, totalCompressed int64
	var successful, failed int
	for result := range results {
		if result.Error != nil {
			fmt.Printf("\nError compressing %s: %v\n", result.Path, result.Error)
			failed++
			continue
		}
		successful++
		totalOriginal += result.OriginalSize
		totalCompressed += result.CompressedSize
	}

	fmt.Printf("\nCompression complete!\n")
	fmt.Printf("Success: %d, Failed: %d\n", successful, failed)
	fmt.Printf("Total original: %s\n", formatSize(totalOriginal))
	fmt.Printf("Total compressed: %s\n", formatSize(totalCompressed))
	if totalCompressed > 0 {
		fmt.Printf("Overall ratio: %.2fx\n", float64(totalOriginal)/float64(totalCompressed))
	}

	return nil
}

func compressFile(filePath, outputDir string) FileResult {
	start := time.Now()

	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	reqBody, _ := json.Marshal(CompressRequest{
		Data: base64.StdEncoding.EncodeToString(data),
	})

	resp, err := client.Post(
		apiBaseURL+"/api/compress",
		"application/json",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := ioutil.ReadAll(resp.Body)
		return FileResult{Path: filePath, Error: fmt.Errorf("API error: %s", string(body))}
	}

	var result CompressResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	compressedData, err := base64.StdEncoding.DecodeString(result.Compressed)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	outputPath := filepath.Join(outputDir, filepath.Base(filePath)+".lz4")
	if err := ioutil.WriteFile(outputPath, compressedData, 0644); err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	return FileResult{
		Path:           filePath,
		OriginalSize:   int64(result.OriginalSize),
		CompressedSize: int64(result.CompressedSize),
		Ratio:          float64(result.OriginalSize) / float64(result.CompressedSize),
		Duration:       time.Since(start),
	}
}

func decompressCommand(c *cli.Context) error {
	if c.NArg() == 0 {
		return fmt.Errorf("please specify files to decompress")
	}

	outputDir := c.String("output")
	untar := c.Bool("untar")

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	var files []string
	for _, path := range c.Args().Slice() {
		info, err := os.Stat(path)
		if err != nil {
			fmt.Printf("Warning: %v\n", err)
			continue
		}

		if info.IsDir() {
			dirFiles, err := filepath.Glob(filepath.Join(path, "*.lz4"))
			if err != nil {
				fmt.Printf("Error finding files: %v\n", err)
				continue
			}
			files = append(files, dirFiles...)
		} else {
			files = append(files, path)
		}
	}

	if len(files) == 0 {
		return fmt.Errorf("no files to decompress")
	}

	fmt.Printf("Decompressing %d files...\n", len(files))
	bar := progressbar.Default(int64(len(files)), "Decompressing")

	for _, file := range files {
		result := decompressFile(file, outputDir, untar)
		if result.Error != nil {
			fmt.Printf("\nError decompressing %s: %v\n", file, result.Error)
		}
		bar.Add(1)
	}

	fmt.Println("\nDecompression complete!")
	return nil
}

func decompressFile(filePath, outputDir string, untar bool) FileResult {
	start := time.Now()

	data, err := ioutil.ReadFile(filePath)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	reqBody, _ := json.Marshal(map[string]string{
		"data": base64.StdEncoding.EncodeToString(data),
	})

	resp, err := client.Post(
		apiBaseURL+"/api/decompress",
		"application/json",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := ioutil.ReadAll(resp.Body)
		return FileResult{Path: filePath, Error: fmt.Errorf("API error: %s", string(body))}
	}

	var result DecompressResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	decompressedData, err := base64.StdEncoding.DecodeString(result.Decompressed)
	if err != nil {
		return FileResult{Path: filePath, Error: err}
	}

	outputPath := filepath.Join(outputDir, strings.TrimSuffix(filepath.Base(filePath), ".lz4"))

	if untar && strings.HasSuffix(outputPath, ".tar") {
		if err := extractTar(decompressedData, outputDir); err != nil {
			return FileResult{Path: filePath, Error: err}
		}
	} else {
		if err := ioutil.WriteFile(outputPath, decompressedData, 0644); err != nil {
			return FileResult{Path: filePath, Error: err}
		}
	}

	return FileResult{
		Path:           filePath,
		CompressedSize: int64(result.CompressedSize),
		Duration:       time.Since(start),
	}
}

func benchmarkCommand(c *cli.Context) error {
	size := c.Int("size")

	fmt.Printf("Running benchmark with %d MB test data...\n\n", size)

	resp, err := client.Get(fmt.Sprintf("%s/api/benchmark?size=%d", apiBaseURL, size))
	if err != nil {
		return fmt.Errorf("failed to run benchmark: %w", err)
	}
	defer resp.Body.Close()

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	fmt.Println(string(body))
	return nil
}

func healthCommand(c *cli.Context) error {
	resp, err := client.Get(apiBaseURL + "/health")
	if err != nil {
		return fmt.Errorf("API is not reachable: %w", err)
	}
	defer resp.Body.Close()

	body, _ := ioutil.ReadAll(resp.Body)
	fmt.Printf("API Health: %s\n", string(body))
	return nil
}

func findFiles(root string, recursive bool, pattern string) ([]string, error) {
	var files []string

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			if !recursive && path != root {
				return filepath.SkipDir
			}
			return nil
		}

		matched, _ := filepath.Match(pattern, info.Name())
		if matched {
			files = append(files, path)
		}
		return nil
	})

	return files, err
}

func createTar(source, target string, recursive bool, pattern string) error {
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	defer file.Close()

	tw := tar.NewWriter(file)
	defer tw.Close()

	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			if !recursive && path != source {
				return filepath.SkipDir
			}
			return nil
		}

		matched, _ := filepath.Match(pattern, info.Name())
		if !matched {
			return nil
		}

		header, err := tar.FileInfoHeader(info, info.Name())
		if err != nil {
			return err
		}

		relPath, _ := filepath.Rel(source, path)
		header.Name = filepath.ToSlash(relPath)

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = io.Copy(tw, file)
		return err
	})
}

func extractTar(data []byte, outputDir string) error {
	tr := tar.NewReader(bytes.NewReader(data))

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		target := filepath.Join(outputDir, header.Name)

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}

			file, err := os.Create(target)
			if err != nil {
				return err
			}

			if _, err := io.Copy(file, tr); err != nil {
				file.Close()
				return err
			}
			file.Close()
		}
	}

	return nil
}

func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
