package main

import (
	"regexp"
	"strings"
	"unicode"
)

type TechTermExtractor struct {
	stopWords map[string]bool
	patterns  []*regexp.Regexp
}

func NewTechTermExtractor() *TechTermExtractor {
	stopWords := map[string]bool{
		"the": true, "a": true, "an": true, "and": true, "or": true,
		"but": true, "in": true, "on": true, "at": true, "to": true,
		"for": true, "of": true, "with": true, "by": true, "from": true,
		"is": true, "are": true, "was": true, "were": true, "be": true,
		"this": true, "that": true, "these": true, "those": true,
		"it": true, "its": true, "as": true, "if": true, "then": true,
	}

	patterns := []*regexp.Regexp{
		regexp.MustCompile(`[A-Z][a-z]+(?:[A-Z][a-z]+)+`),
		regexp.MustCompile(`[A-Z]{2,}`),
		regexp.MustCompile(`\b(?:Go|Python|JavaScript|TypeScript|Java|Rust|C\+\+|C#|Ruby|PHP|Swift|Kotlin)\b`),
		regexp.MustCompile(`\b(?:API|REST|GraphQL|JSON|XML|HTML|CSS|HTTP|HTTPS|TCP|UDP|FTP|SSH)\b`),
		regexp.MustCompile(`\b(?:Docker|Kubernetes|AWS|Azure|GCP|CI/CD|DevOps|Microservices)\b`),
		regexp.MustCompile(`\b(?:React|Vue|Angular|Next\.js|Nuxt|Svelte|Node\.js|Express|Django|Flask|Rails|Spring)\b`),
		regexp.MustCompile(`\b(?:Neo4j|MongoDB|PostgreSQL|MySQL|Redis|Elasticsearch|Cassandra|DynamoDB)\b`),
		regexp.MustCompile(`\b(?:Git|GitHub|GitLab|Bitbucket|Jenkins|Travis|CircleCI)\b`),
	}

	return &TechTermExtractor{
		stopWords: stopWords,
		patterns:  patterns,
	}
}

func (e *TechTermExtractor) ExtractTerms(content, title string) []string {
	termSet := make(map[string]bool)

	for _, pattern := range e.patterns {
		matches := pattern.FindAllString(content, -1)
		for _, match := range matches {
			if e.isValidTerm(match) {
				termSet[match] = true
			}
		}
	}

	titleTerms := e.extractFromTitle(title)
	for _, term := range titleTerms {
		termSet[term] = true
	}

	terms := make([]string, 0, len(termSet))
	for term := range termSet {
		terms = append(terms, term)
	}

	return terms
}

func (e *TechTermExtractor) extractFromTitle(title string) []string {
	var terms []string
	words := strings.FieldsFunc(title, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '.' && r != '-'
	})

	for i := 0; i < len(words); i++ {
		word := words[i]
		if len(word) > 1 && !e.stopWords[strings.ToLower(word)] {
			if unicode.IsUpper(rune(word[0])) {
				terms = append(terms, word)
			}
		}
	}

	return terms
}

func (e *TechTermExtractor) isValidTerm(term string) bool {
	term = strings.TrimSpace(term)
	if len(term) < 2 || len(term) > 50 {
		return false
	}
	if e.stopWords[strings.ToLower(term)] {
		return false
	}
	return true
}
