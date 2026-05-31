package main

type TechDocument struct {
	URL        string   `json:"url"`
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	TechTerms  []string `json:"tech_terms"`
	References []string `json:"references"`
}

type TechTerm struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
}

type Reference struct {
	FromURL string `json:"from_url"`
	ToURL   string `json:"to_url"`
	Context string `json:"context"`
}

type GraphData struct {
	Nodes []GraphNode `json:"nodes"`
	Links []GraphLink `json:"links"`
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
