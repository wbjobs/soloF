package main

import (
	"context"
	"fmt"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type Neo4jStore struct {
	driver neo4j.DriverWithContext
	ctx    context.Context
}

func NewNeo4jStore(uri, username, password string) (*Neo4jStore, error) {
	ctx := context.Background()
	driver, err := neo4j.NewDriverWithContext(uri, neo4j.BasicAuth(username, password, ""))
	if err != nil {
		return nil, fmt.Errorf("failed to create driver: %w", err)
	}

	if err := driver.VerifyConnectivity(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}

	return &Neo4jStore{
		driver: driver,
		ctx:    ctx,
	}, nil
}

func (s *Neo4jStore) Close() {
	_ = s.driver.Close(s.ctx)
}

func (s *Neo4jStore) SaveDocument(doc *TechDocument) error {
	session := s.driver.NewSession(s.ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(s.ctx)

	_, err := session.ExecuteWrite(s.ctx, func(tx neo4j.ManagedTransaction) (any, error) {
		docID := doc.URL

		_, err := tx.Run(s.ctx, `
			MERGE (doc:Document {url: $url})
			SET doc.title = $title,
			    doc.content = $content,
			    doc.crawled_at = $crawledAt
			RETURN doc
		`, map[string]any{
			"url":       doc.URL,
			"title":     doc.Title,
			"content":   doc.Content,
			"crawledAt": time.Now(),
		})
		if err != nil {
			return nil, err
		}

		for _, term := range doc.TechTerms {
			category := categorizeTerm(term)
			_, err := tx.Run(s.ctx, `
				MERGE (t:TechTerm {name: $name})
				SET t.category = $category
				WITH t
				MATCH (doc:Document {url: $docUrl})
				MERGE (doc)-[:CONTAINS_TERM]->(t)
			`, map[string]any{
				"name":    term,
				"category": category,
				"docUrl":  docID,
			})
			if err != nil {
				return nil, err
			}
		}

		for _, refURL := range doc.References {
			_, err := tx.Run(s.ctx, `
				MERGE (target:Document {url: $targetUrl})
				WITH target
				MATCH (source:Document {url: $sourceUrl})
				MERGE (source)-[:REFERENCES]->(target)
			`, map[string]any{
				"sourceUrl": docID,
				"targetUrl": refURL,
			})
			if err != nil {
				return nil, err
			}
		}

		return nil, nil
	})

	return err
}

func categorizeTerm(term string) string {
	categories := map[string][]string{
		"Programming Language": {"Go", "Golang", "Python", "JavaScript", "TypeScript", "Java", "C++", "Rust"},
		"Framework":            {"Colly", "gqlgen", "React", "Vue", "Angular", "Gin", "Echo", "Fiber"},
		"Database":             {"Neo4j", "MongoDB", "PostgreSQL", "MySQL", "Redis", "GraphQL"},
		"Concept":              {"API", "REST", "JSON", "HTTP", "TCP", "UDP", "Docker", "Kubernetes"},
	}

	for cat, terms := range categories {
		for _, t := range terms {
			if term == t {
				return cat
			}
		}
	}
	return "Other"
}
