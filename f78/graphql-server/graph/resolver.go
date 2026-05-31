package graph

import (
	"context"
	"fmt"
	"time"

	"graphql-server/graph/model"
)

type Resolver struct {
	store         *Neo4jStore
	vectorService *VectorService
}

func NewResolver(store *Neo4jStore, vectorService *VectorService) *Resolver {
	return &Resolver{
		store:         store,
		vectorService: vectorService,
	}
}

func (r *queryResolver) Documents(ctx context.Context) ([]*model.Document, error) {
	return r.store.GetDocuments(ctx)
}

func (r *queryResolver) Document(ctx context.Context, url string) (*model.Document, error) {
	return r.store.GetDocument(ctx, url)
}

func (r *queryResolver) TechTerms(ctx context.Context) ([]*model.TechTerm, error) {
	return r.store.GetTechTerms(ctx)
}

func (r *queryResolver) TechTerm(ctx context.Context, name string) (*model.TechTerm, error) {
	return r.store.GetTechTerm(ctx, name)
}

func (r *queryResolver) GraphData(ctx context.Context, limit int) (*model.GraphData, error) {
	return r.store.GetGraphData(ctx, limit)
}

func (r *queryResolver) Search(ctx context.Context, query string, limit int) ([]*model.SearchResult, error) {
	return r.store.Search(ctx, query, limit)
}

func (r *queryResolver) SemanticSearch(ctx context.Context, query string, maxDepth int, minScore float64) (*model.SemanticSearchResult, error) {
	return r.store.SemanticSearch(ctx, r.vectorService, query, maxDepth, minScore)
}

func (r *queryResolver) Stats(ctx context.Context) (*model.Stats, error) {
	return r.store.GetStats(ctx)
}

func (r *mutationResolver) TriggerCrawl(ctx context.Context, url string, maxDepth int) (*model.CrawlJob, error) {
	job := &model.CrawlJob{
		ID:        fmt.Sprintf("job-%d", time.Now().Unix()),
		Status:    "PENDING",
		StartURL:  url,
		MaxDepth:  maxDepth,
		CreatedAt: time.Now().Format(time.RFC3339),
	}
	return job, nil
}

func (r *mutationResolver) ClearDatabase(ctx context.Context) (bool, error) {
	return true, r.store.ClearDatabase(ctx)
}

type queryResolver struct{ *Resolver }
type mutationResolver struct{ *Resolver }

func (r *Resolver) Query() QueryResolver     { return &queryResolver{r} }
func (r *Resolver) Mutation() MutationResolver { return &mutationResolver{r} }
