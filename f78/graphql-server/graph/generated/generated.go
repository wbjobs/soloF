package generated

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"graphql-server/graph/model"
)

type ResolverRoot interface {
	Query() QueryResolver
	Mutation() MutationResolver
}

type QueryResolver interface {
	Documents(ctx context.Context) ([]*model.Document, error)
	Document(ctx context.Context, url string) (*model.Document, error)
	TechTerms(ctx context.Context) ([]*model.TechTerm, error)
	TechTerm(ctx context.Context, name string) (*model.TechTerm, error)
	GraphData(ctx context.Context, limit int) (*model.GraphData, error)
	Search(ctx context.Context, query string, limit int) ([]*model.SearchResult, error)
	Stats(ctx context.Context) (*model.Stats, error)
}

type MutationResolver interface {
	TriggerCrawl(ctx context.Context, url string, maxDepth int) (*model.CrawlJob, error)
	ClearDatabase(ctx context.Context) (bool, error)
}

type Config struct {
	Resolvers ResolverRoot
}

func NewExecutableSchema(cfg Config) graphql.ExecutableSchema {
	panic("This is a placeholder. Run `go run github.com/99designs/gqlgen generate` to generate the actual code.")
}
