package model

type Document struct {
	URL          string      `json:"url"`
	Title        string      `json:"title"`
	Content      *string     `json:"content"`
	CrawledAt    *string     `json:"crawledAt"`
	TechTerms    []*TechTerm `json:"techTerms"`
	References   []*Document `json:"references"`
	ReferencedBy []*Document `json:"referencedBy"`
}

type TechTerm struct {
	Name         string      `json:"name"`
	Category     string      `json:"category"`
	Documents    []*Document `json:"documents"`
	RelatedTerms []*TechTerm `json:"relatedTerms"`
}

type GraphData struct {
	Nodes []*GraphNode `json:"nodes"`
	Links []*GraphLink `json:"links"`
}

type GraphNode struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Val      int    `json:"val"`
}

type GraphLink struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Name   string `json:"name"`
}

type SearchResult struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Category *string `json:"category"`
}

type Stats struct {
	DocumentCount     int        `json:"documentCount"`
	TechTermCount     int        `json:"techTermCount"`
	RelationshipCount int       `json:"relationshipCount"`
	TopTerms          []*TopTerm `json:"topTerms"`
}

type TopTerm struct {
	Name     string `json:"name"`
	Count    int    `json:"count"`
	Category string `json:"category"`
}

type CrawlJob struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	StartURL  string `json:"startUrl"`
	MaxDepth  int    `json:"maxDepth"`
	CreatedAt string `json:"createdAt"`
}

type SemanticSearchResult struct {
	Query              string       `json:"query"`
	Nodes              []*GraphNode `json:"nodes"`
	Paths              []*GraphPath `json:"paths"`
	HighlightedNodeIds []string     `json:"highlightedNodeIds"`
	HighlightedLinkIds []string     `json:"highlightedLinkIds"`
}

type GraphPath struct {
	Nodes []*GraphNode `json:"nodes"`
	Links []*GraphLink `json:"links"`
	Score float64      `json:"score"`
}
