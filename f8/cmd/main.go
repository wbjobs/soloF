package main

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/prometheus-tsdb-manager/pkg/api"
	"github.com/prometheus-tsdb-manager/pkg/cli"
)

func main() {
	go func() {
		if cli.IsServerMode() {
			server := api.NewServer(cli.GetDataDir(), cli.GetLogger())
			if err := server.Run(cli.GetServerPort()); err != nil {
				cli.GetLogger().Fatalf("Server failed: %v", err)
			}
		}
	}()

	if !cli.IsServerMode() {
		if err := cli.Execute(); err != nil {
			cli.GetLogger().Fatal(err)
		}
	} else {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		cli.GetLogger().Info("Shutting down server...")
	}
}
