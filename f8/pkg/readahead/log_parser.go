package readahead

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	promQueryRegex = regexp.MustCompile(`query="([^"]+)"`)
	timeRangeRegex = regexp.MustCompile(`start=([\d.]+), end=([\d.]+)`)
	stepRegex      = regexp.MustCompile(`step=([\d.]+)([smh])`)
	durationRegex  = regexp.MustCompile(`duration=([\d.]+)([smhµ]+)`)
	seriesRegex    = regexp.MustCompile(`series=(\d+)`)
	timestampRegex = regexp.MustCompile(`^(\w+\s+\d+\s+\d+:\d+:\d+|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})`)
)

type LogParser struct {
	logger     Logger
	maxEntries int
}

func NewLogParser(logger Logger, maxEntries int) *LogParser {
	return &LogParser{
		logger:     logger,
		maxEntries: maxEntries,
	}
}

func (p *LogParser) ParseLogFile(filePath string) ([]QueryLogEntry, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []QueryLogEntry
	scanner := bufio.NewScanner(file)
	lineCount := 0

	for scanner.Scan() && lineCount < p.maxEntries {
		line := scanner.Text()
		entry, err := p.parseLogLine(line)
		if err == nil && entry != nil {
			entries = append(entries, *entry)
			lineCount++
		}
	}

	if err := scanner.Err(); err != nil {
		return entries, err
	}

	p.logger.Info("Parsed query log", "entries", len(entries), "file", filepath.Base(filePath))
	return entries, nil
}

func (p *LogParser) parseLogLine(line string) (*QueryLogEntry, error) {
	if !strings.Contains(line, "query=") {
		return nil, nil
	}

	entry := &QueryLogEntry{}

	if tsMatch := timestampRegex.FindString(line); tsMatch != "" {
		if ts, err := time.ParseInLocation(time.Stamp, tsMatch, time.Local); err == nil {
			entry.Timestamp = ts
		} else if ts, err := time.Parse(time.RFC3339, tsMatch); err == nil {
			entry.Timestamp = ts
		}
	}

	if qMatch := promQueryRegex.FindStringSubmatch(line); len(qMatch) > 1 {
		entry.Query = qMatch[1]
		entry.LabelMatchers = p.extractLabelMatchers(qMatch[1])
	}

	if trMatch := timeRangeRegex.FindStringSubmatch(line); len(trMatch) > 2 {
		if start, err := strconv.ParseFloat(trMatch[1], 64); err == nil {
			entry.TimeRange.Start = int64(start * 1000)
		}
		if end, err := strconv.ParseFloat(trMatch[2], 64); err == nil {
			entry.TimeRange.End = int64(end * 1000)
		}
		entry.IsRangeQuery = entry.TimeRange.Start != entry.TimeRange.End
	}

	if sMatch := stepRegex.FindStringSubmatch(line); len(sMatch) > 2 {
		if stepVal, err := strconv.ParseFloat(sMatch[1], 64); err == nil {
			entry.Step = convertToDuration(stepVal, sMatch[2])
		}
	}

	if dMatch := durationRegex.FindStringSubmatch(line); len(dMatch) > 2 {
		if durVal, err := strconv.ParseFloat(dMatch[1], 64); err == nil {
			entry.Duration = convertToDuration(durVal, dMatch[2])
		}
	}

	if seriesMatch := seriesRegex.FindStringSubmatch(line); len(seriesMatch) > 1 {
		if count, err := strconv.Atoi(seriesMatch[1]); err == nil {
			entry.SeriesCount = count
		}
	}

	return entry, nil
}

func (p *LogParser) extractLabelMatchers(query string) []string {
	var matchers []string
	labelRegex := regexp.MustCompile(`(\w+)\s*=~\s*"([^"]+)"|(\w+)\s*=\s*"([^"]+)"`)
	matches := labelRegex.FindAllStringSubmatch(query, -1)
	for _, m := range matches {
		if m[1] != "" && m[2] != "" {
			matchers = append(matchers, m[1]+"=~"+m[2])
		} else if m[3] != "" && m[4] != "" {
			matchers = append(matchers, m[3]+"="+m[4])
		}
	}
	return matchers
}

func convertToDuration(value float64, unit string) time.Duration {
	switch unit {
	case "s", "sec":
		return time.Duration(value * float64(time.Second))
	case "m", "min":
		return time.Duration(value * float64(time.Minute))
	case "h", "hour":
		return time.Duration(value * float64(time.Hour))
	case "ms":
		return time.Duration(value * float64(time.Millisecond))
	case "µs", "us":
		return time.Duration(value * float64(time.Microsecond))
	default:
		return time.Duration(value * float64(time.Second))
	}
}

func (p *LogParser) ParseJSONLogFile(filePath string) ([]QueryLogEntry, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []QueryLogEntry
	decoder := json.NewDecoder(file)
	lineCount := 0

	for decoder.More() && lineCount < p.maxEntries {
		var raw map[string]interface{}
		if err := decoder.Decode(&raw); err != nil {
			continue
		}

		entry := &QueryLogEntry{}

		if ts, ok := raw["timestamp"].(string); ok {
			if parsed, err := time.Parse(time.RFC3339, ts); err == nil {
				entry.Timestamp = parsed
			}
		}

		if query, ok := raw["query"].(string); ok {
			entry.Query = query
			entry.LabelMatchers = p.extractLabelMatchers(query)
		}

		if start, ok := raw["start"].(float64); ok {
			entry.TimeRange.Start = int64(start * 1000)
		}
		if end, ok := raw["end"].(float64); ok {
			entry.TimeRange.End = int64(end * 1000)
		}

		if dur, ok := raw["duration"].(float64); ok {
			entry.Duration = time.Duration(dur * float64(time.Second))
		}

		if series, ok := raw["series"].(float64); ok {
			entry.SeriesCount = int(series)
		}

		entries = append(entries, *entry)
		lineCount++
	}

	p.logger.Info("Parsed JSON query log", "entries", len(entries), "file", filepath.Base(filePath))
	return entries, nil
}

func (p *LogParser) ScanLogsDir(logDir string) ([]QueryLogEntry, error) {
	var allEntries []QueryLogEntry

	err := filepath.Walk(logDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		ext := filepath.Ext(path)
		var entries []QueryLogEntry
		var parseErr error

		if ext == ".json" || strings.Contains(path, "json") {
			entries, parseErr = p.ParseJSONLogFile(path)
		} else {
			entries, parseErr = p.ParseLogFile(path)
		}

		if parseErr == nil {
			allEntries = append(allEntries, entries...)
		}
		return nil
	})

	return allEntries, err
}
