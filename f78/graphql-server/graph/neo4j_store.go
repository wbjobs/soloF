package graph

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"graphql-server/graph/model"
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

func (s *Neo4jStore) GetDocuments(ctx context.Context) ([]*model.Document, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (d:Document)
		RETURN d.url AS url, d.title AS title, d.content AS content, d.crawled_at AS crawledAt
		ORDER BY d.crawled_at DESC
		LIMIT 100
	`, nil)
	if err != nil {
		return nil, err
	}

	var docs []*model.Document
	for result.Next(ctx) {
		record := result.Record()
		doc := &model.Document{
			URL:       getString(record, "url"),
			Title:     getString(record, "title"),
			Content:   getString(record, "content"),
			CrawledAt: getString(record, "crawledAt"),
		}
		docs = append(docs, doc)
	}

	return docs, result.Err()
}

func (s *Neo4jStore) GetDocument(ctx context.Context, url string) (*model.Document, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (d:Document {url: $url})
		RETURN d.url AS url, d.title AS title, d.content AS content, d.crawled_at AS crawledAt
	`, map[string]any{"url": url})
	if err != nil {
		return nil, err
	}

	if !result.Next(ctx) {
		return nil, nil
	}

	record := result.Record()
	doc := &model.Document{
		URL:       getString(record, "url"),
		Title:     getString(record, "title"),
		Content:   getString(record, "content"),
		CrawledAt: getString(record, "crawledAt"),
	}

	return doc, result.Err()
}

func (s *Neo4jStore) GetTechTerms(ctx context.Context) ([]*model.TechTerm, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (t:TechTerm)
		RETURN t.name AS name, t.category AS category
		ORDER BY t.name
		LIMIT 200
	`, nil)
	if err != nil {
		return nil, err
	}

	var terms []*model.TechTerm
	for result.Next(ctx) {
		record := result.Record()
		term := &model.TechTerm{
			Name:     getString(record, "name"),
			Category: getString(record, "category"),
		}
		terms = append(terms, term)
	}

	return terms, result.Err()
}

func (s *Neo4jStore) GetTechTerm(ctx context.Context, name string) (*model.TechTerm, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (t:TechTerm {name: $name})
		RETURN t.name AS name, t.category AS category
	`, map[string]any{"name": name})
	if err != nil {
		return nil, err
	}

	if !result.Next(ctx) {
		return nil, nil
	}

	record := result.Record()
	term := &model.TechTerm{
		Name:     getString(record, "name"),
		Category: getString(record, "category"),
	}

	return term, result.Err()
}

func (s *Neo4jStore) GetGraphData(ctx context.Context, limit int) (*model.GraphData, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	nodeResult, err := session.Run(ctx, `
		MATCH (t:TechTerm)
		OPTIONAL MATCH (t)<-[:CONTAINS_TERM]-(:Document)
		WITH t, count(*) AS docCount
		RETURN t.name AS id, t.name AS name, t.category AS category, docCount AS val
		ORDER BY val DESC
		LIMIT $limit
	`, map[string]any{"limit": limit})
	if err != nil {
		return nil, err
	}

	var nodes []*model.GraphNode
	nodeSet := make(map[string]bool)
	for nodeResult.Next(ctx) {
		record := nodeResult.Record()
		node := &model.GraphNode{
			ID:       getString(record, "id"),
			Name:     getString(record, "name"),
			Category: getString(record, "category"),
			Val:      getInt(record, "val"),
		}
		nodes = append(nodes, node)
		nodeSet[node.ID] = true
	}

	if err := nodeResult.Err(); err != nil {
		return nil, err
	}

	linkResult, err := session.Run(ctx, `
		MATCH (d:Document)-[:CONTAINS_TERM]->(t1:TechTerm)
		MATCH (d)-[:CONTAINS_TERM]->(t2:TechTerm)
		WHERE t1.name < t2.name
		WITH t1, t2, count(d) AS weight
		RETURN t1.name AS source, t2.name AS target, 'CO-OCCUR' AS name, weight
		ORDER BY weight DESC
		LIMIT $limit
	`, map[string]any{"limit": limit * 2})
	if err != nil {
		return nil, err
	}

	var links []*model.GraphLink
	for linkResult.Next(ctx) {
		record := linkResult.Record()
		source := getString(record, "source")
		target := getString(record, "target")
		if nodeSet[source] && nodeSet[target] {
			link := &model.GraphLink{
				Source: source,
				Target: target,
				Name:   getString(record, "name"),
			}
			links = append(links, link)
		}
	}

	return &model.GraphData{
		Nodes: nodes,
		Links: links,
	}, linkResult.Err()
}

func (s *Neo4jStore) Search(ctx context.Context, query string, limit int) ([]*model.SearchResult, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		CALL db.index.fulltext.queryNodes("defaultIndex', $query)
		YIELD node, score
		RETURN node, labels(node)[0] AS type, score
		ORDER BY score DESC
		LIMIT $limit
	`, map[string]any{"query": query, "limit": limit})
	if err != nil {
		return nil, err
	}

	var results []*model.SearchResult
	for result.Next(ctx) {
		record := result.Record()
		node, _ := record.Get("node")
		nodeValue := node.(neo4j.Node)
		props := nodeValue.Props

		name := ""
		if n, ok := props["name"]; ok {
			name = n.(string)
		} else if t, ok := props["title"]; ok {
			name = t.(string)
		}

		category := ""
		if c, ok := props["category"]; ok {
			category = c.(string)
		}

		searchResult := &model.SearchResult{
			ID:       string(nodeValue.ElementId),
			Name:     name,
			Type:     getString(record, "type"),
			Category: &category,
		}
		results = append(results, searchResult)
	}

	return results, result.Err()
}

func (s *Neo4jStore) GetStats(ctx context.Context) (*model.Stats, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (d:Document)
		RETURN count(d) AS docCount
	`, nil)
	if err != nil {
		return nil, err
	}

	var docCount int64
	if result.Next(ctx) {
		docCount, _ = result.Record().Get("docCount").(int64)
	}

	result, err = session.Run(ctx, `
		MATCH (t:TechTerm)
		RETURN count(t) AS termCount
	`, nil)
	if err != nil {
		return nil, err
	}

	var termCount int64
	if result.Next(ctx) {
		termCount, _ = result.Record().Get("termCount").(int64)
	}

	result, err = session.Run(ctx, `
		MATCH ()-[r]->()
		RETURN count(r) AS relCount
	`, nil)
	if err != nil {
		return nil, err
	}

	var relCount int64
	if result.Next(ctx) {
		relCount, _ = result.Record().Get("relCount").(int64)
	}

	result, err = session.Run(ctx, `
		MATCH (t:TechTerm)<-[:CONTAINS_TERM]-(d:Document)
		RETURN t.name AS name, t.category AS category, count(d) AS count
		ORDER BY count DESC
		LIMIT 10
	`, nil)
	if err != nil {
		return nil, err
	}

	var topTerms []*model.TopTerm
	for result.Next(ctx) {
		record := result.Record()
		topTerm := &model.TopTerm{
			Name:     getString(record, "name"),
			Count:    getInt(record, "count"),
			Category: getString(record, "category"),
		}
		topTerms = append(topTerms, topTerm)
	}

	return &model.Stats{
		DocumentCount:     int(docCount),
		TechTermCount:   int(termCount),
		RelationshipCount: int(relCount),
		TopTerms:       topTerms,
	}, result.Err()
}

func (s *Neo4jStore) ClearDatabase(ctx context.Context) error {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeWrite})
	defer session.Close(ctx)

	_, err := session.Run(ctx, `
		MATCH (n)
		DETACH DELETE n
	`, nil)

	return err
}

func (s *Neo4jStore) SemanticSearch(ctx context.Context, vs *VectorService, query string, maxDepth int, minScore float64) (*model.SemanticSearchResult, error) {
	session := s.driver.NewSession(ctx, neo4j.SessionConfig{AccessMode: neo4j.AccessModeRead})
	defer session.Close(ctx)

	result, err := session.Run(ctx, `
		MATCH (t:TechTerm)
		RETURN t.name AS name, t.category AS category
	`, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch tech terms: %w", err)
	}

	var terms []string
	termMap := make(map[string]string)
	for result.Next(ctx) {
		record := result.Record()
		name := getString(record, "name")
		category := getString(record, "category")
		terms = append(terms, name)
		termMap[name] = category
	}

	if len(terms) == 0 {
		return &model.SemanticSearchResult{
			Query:              query,
			Nodes:              []*model.GraphNode{},
			Paths:              []*model.GraphPath{},
			HighlightedNodeIds: []string{},
			HighlightedLinkIds: []string{},
		}, nil
	}

	simResult, err := vs.ComputeSimilarity(query, terms, 50)
	if err != nil {
		return nil, fmt.Errorf("failed to compute similarity: %w", err)
	}

	filteredResults := make([]SimilarityResult, 0)
	for _, r := range simResult.Results {
		if r.Score >= minScore {
			filteredResults = append(filteredResults, SimilarityResult{
				Text:  r.Text,
				Score: r.Score,
				Index: r.Index,
			})
		}
	}

	if len(filteredResults) == 0 {
		return &model.SemanticSearchResult{
			Query:              query,
			Nodes:              []*model.GraphNode{},
			Paths:              []*model.GraphPath{},
			HighlightedNodeIds: []string{},
			HighlightedLinkIds: []string{},
		}, nil
	}

	seedTerms := make([]string, 0, len(filteredResults))
	termScores := make(map[string]float64)
	for _, r := range filteredResults {
		seedTerms = append(seedTerms, r.Text)
		termScores[r.Text] = r.Score
	}

	pathResult, err := session.Run(ctx, `
		MATCH path = (start:TechTerm)-[*1..$maxDepth]-(end:TechTerm)
		WHERE start.name IN $seedTerms AND end.name IN $seedTerms AND start <> end
		WITH path, 
		     [node IN nodes(path) | node.name] AS nodeNames,
		     [rel IN relationships(path) | type(rel)] AS relTypes
		RETURN path, nodeNames, relTypes
		LIMIT 100
	`, map[string]any{
		"seedTerms": seedTerms,
		"maxDepth":  maxDepth,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to find paths: %w", err)
	}

	type pathInfo struct {
		nodes    []*model.GraphNode
		links    []*model.GraphLink
		score    float64
		nodeSet  map[string]bool
	}

	paths := make([]pathInfo, 0)
	highlightedNodeSet := make(map[string]bool)
	highlightedLinkSet := make(map[string]bool)

	for pathResult.Next(ctx) {
		record := pathResult.Record()
		nodeNamesIf, _ := record.Get("nodeNames")
		nodeNames := nodeNamesIf.([]string)

		pathScore := 0.0
		nodeCount := 0
		pathNodeSet := make(map[string]bool)
		for _, name := range nodeNames {
			if score, ok := termScores[name]; ok {
				pathScore += score
				nodeCount++
			}
			pathNodeSet[name] = true
		}
		pathScore = pathScore / math.Max(float64(nodeCount), 1)

		nodes := make([]*model.GraphNode, 0, len(nodeNames))
		for _, name := range nodeNames {
			nodes = append(nodes, &model.GraphNode{
				ID:       name,
				Name:     name,
				Category: termMap[name],
				Val:      1,
			})
			highlightedNodeSet[name] = true
		}

		links := make([]*model.GraphLink, 0, len(nodeNames)-1)
		for i := 0; i < len(nodeNames)-1; i++ {
			source := nodeNames[i]
			target := nodeNames[i+1]
			linkID := fmt.Sprintf("%s-%s", source, target)
			links = append(links, &model.GraphLink{
				Source: source,
				Target: target,
				Name:   "RELATED",
			})
			highlightedLinkSet[linkID] = true
		}

		paths = append(paths, pathInfo{
			nodes:   nodes,
			links:   links,
			score:   pathScore,
			nodeSet: pathNodeSet,
		})
	}

	allNodes := make([]*model.GraphNode, 0)
	for name := range highlightedNodeSet {
		allNodes = append(allNodes, &model.GraphNode{
			ID:       name,
			Name:     name,
			Category: termMap[name],
			Val:      1,
		})
	}

	graphPaths := make([]*model.GraphPath, 0, len(paths))
	for _, p := range paths {
		graphPaths = append(graphPaths, &model.GraphPath{
			Nodes: p.nodes,
			Links: p.links,
			Score: p.score,
		})
	}

	highlightedNodeIds := make([]string, 0, len(highlightedNodeSet))
	for id := range highlightedNodeSet {
		highlightedNodeIds = append(highlightedNodeIds, id)
	}

	highlightedLinkIds := make([]string, 0, len(highlightedLinkSet))
	for id := range highlightedLinkSet {
		highlightedLinkIds = append(highlightedLinkIds, id)
	}

	return &model.SemanticSearchResult{
		Query:              query,
		Nodes:              allNodes,
		Paths:              graphPaths,
		HighlightedNodeIds: highlightedNodeIds,
		HighlightedLinkIds: highlightedLinkIds,
	}, nil
}

func getString(record *neo4j.Record, key string) string {
	if value, ok := record.Get(key); ok {
		if str, ok := value.(string); ok {
			return str
		}
	}
	return ""
}

func getInt(record *neo4j.Record, key string) int {
	if value, ok := record.Get(key); ok {
		switch v := value.(type) {
		case int64:
			return int(v)
		case int:
			return v
		}
	}
	return 0
}
