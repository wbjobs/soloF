package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

var (
	cfgFile     string
	dataDir     string
	dryRun      bool
	verbose     bool
	serverMode  bool
	serverPort  int
	logger      *zap.SugaredLogger
)

var rootCmd = &cobra.Command{
	Use:   "prometheus-tsdb-manager",
	Short: "Prometheus TSDB Index Manager - Analyze and optimize Prometheus TSDB",
	Long:  `A command-line tool for analyzing and optimizing Prometheus TSDB block data, including index reconstruction and compression optimization.`,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	cobra.OnInitialize(initConfig, initLogger)

	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.prometheus-tsdb-manager.yaml)")
	rootCmd.PersistentFlags().StringVar(&dataDir, "data-dir", "./data", "Path to Prometheus data directory")
	rootCmd.PersistentFlags().BoolVar(&dryRun, "dry-run", false, "Run in dry-run mode without making changes")
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "Enable verbose output")
	rootCmd.PersistentFlags().BoolVar(&serverMode, "server", false, "Run as web server with API")
	rootCmd.PersistentFlags().IntVar(&serverPort, "port", 8080, "Server port")

	viper.BindPFlag("data_dir", rootCmd.PersistentFlags().Lookup("data-dir"))
	viper.BindPFlag("dry_run", rootCmd.PersistentFlags().Lookup("dry-run"))
}

func initConfig() {
	if cfgFile != "" {
		viper.SetConfigFile(cfgFile)
	} else {
		home, err := os.UserHomeDir()
		cobra.CheckErr(err)

		viper.AddConfigPath(home)
		viper.SetConfigType("yaml")
		viper.SetConfigName(".prometheus-tsdb-manager")
	}

	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err == nil {
		fmt.Fprintln(os.Stderr, "Using config file:", viper.ConfigFileUsed())
	}
}

func initLogger() {
	config := zap.NewProductionConfig()
	if verbose {
		config.Level = zap.NewAtomicLevelAt(zap.DebugLevel)
	}
	l, _ := config.Build()
	logger = l.Sugar()
}

func GetContext() context.Context {
	return context.Background()
}

func GetDataDir() string {
	absPath, _ := filepath.Abs(dataDir)
	return absPath
}

func GetLogger() *zap.SugaredLogger {
	return logger
}

func IsServerMode() bool {
	return serverMode
}

func GetServerPort() int {
	return serverPort
}
