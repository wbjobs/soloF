package com.tsdb;

import com.tsdb.downsampling.DownsamplingEngine;
import com.tsdb.downsampling.DownsamplingRule;
import com.tsdb.engine.LSMEngine;
import com.tsdb.http.DownsamplingHandler;
import com.tsdb.http.QueryHandler;
import com.tsdb.http.StatsHandler;
import com.tsdb.http.WriteHandler;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.servlet.ServletContextHandler;
import org.eclipse.jetty.servlet.ServletHolder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.util.List;

public class TSDBServer {
    private static final Logger logger = LoggerFactory.getLogger(TSDBServer.class);

    private final TSDBConfig config;
    private LSMEngine engine;
    private DownsamplingEngine downsamplingEngine;
    private Server server;

    public TSDBServer(TSDBConfig config) {
        this.config = config;
    }

    public void start() throws Exception {
        logger.info("Starting LSM Time Series Database...");

        engine = new LSMEngine(
                config.getDataDir(),
                config.getWalDir(),
                config.getMemtableMaxSize(),
                config.getCompactionMinSSTables(),
                config.getCompactionMaxSSTables(),
                config.getCompactionLevelMaxSize()
        );

        List<DownsamplingRule> downsamplingRules = config.getDownsamplingRules();
        if (downsamplingRules.isEmpty()) {
            downsamplingEngine = new DownsamplingEngine(engine);
        } else {
            downsamplingEngine = new DownsamplingEngine(engine, downsamplingRules);
        }
        downsamplingEngine.start();

        startHTTPServer();

        Runtime.getRuntime().addShutdownHook(new Thread(this::stop));

        logger.info("TSDB Server started successfully");
        logger.info("HTTP API available at http://{}:{}", config.getHttpHost(), config.getHttpPort());
        logger.info("Endpoints:");
        logger.info("  POST /api/v1/write              - Write data points");
        logger.info("  GET  /api/v1/query              - Query time series");
        logger.info("  GET  /api/v1/stats              - Database statistics");
        logger.info("  GET  /api/v1/downsampling       - Get downsampling rules and stats");
        logger.info("  POST /api/v1/downsampling       - Add downsampling rule");
        logger.info("  PUT  /api/v1/downsampling/{id}  - Update downsampling rule");
        logger.info("  DELETE /api/v1/downsampling/{id} - Delete downsampling rule");
        logger.info("  POST /api/v1/downsampling/run   - Run downsampling immediately");
    }

    private void startHTTPServer() throws Exception {
        server = new Server(new InetSocketAddress(config.getHttpHost(), config.getHttpPort()));

        ServletContextHandler context = new ServletContextHandler(ServletContextHandler.SESSIONS);
        context.setContextPath("/");
        server.setHandler(context);

        context.addServlet(new ServletHolder(new WriteHandler(engine)), "/api/v1/write");
        context.addServlet(new ServletHolder(new QueryHandler(engine)), "/api/v1/query");
        context.addServlet(new ServletHolder(new StatsHandler(engine)), "/api/v1/stats");
        context.addServlet(new ServletHolder(new DownsamplingHandler(downsamplingEngine)), "/api/v1/downsampling/*");

        server.start();
    }

    public void stop() {
        logger.info("Shutting down TSDB Server...");

        try {
            if (server != null) {
                server.stop();
            }
        } catch (Exception e) {
            logger.error("Error stopping HTTP server", e);
        }

        try {
            if (downsamplingEngine != null) {
                downsamplingEngine.close();
            }
        } catch (Exception e) {
            logger.error("Error closing downsampling engine", e);
        }

        try {
            if (engine != null) {
                engine.close();
            }
        } catch (Exception e) {
            logger.error("Error closing LSM engine", e);
        }

        logger.info("TSDB Server shutdown complete");
    }

    public static void main(String[] args) {
        try {
            TSDBConfig config = TSDBConfig.load();

            for (int i = 0; i < args.length; i++) {
                switch (args[i]) {
                    case "--data-dir":
                        if (i + 1 < args.length) {
                            System.setProperty("data.dir", args[++i]);
                        }
                        break;
                    case "--wal-dir":
                        if (i + 1 < args.length) {
                            System.setProperty("wal.dir", args[++i]);
                        }
                        break;
                    case "--port":
                        if (i + 1 < args.length) {
                            System.setProperty("http.port", args[++i]);
                        }
                        break;
                    case "--host":
                        if (i + 1 < args.length) {
                            System.setProperty("http.host", args[++i]);
                        }
                        break;
                    case "--memtable-size":
                        if (i + 1 < args.length) {
                            System.setProperty("memtable.max.size", args[++i]);
                        }
                        break;
                    case "--help":
                    case "-h":
                        printHelp();
                        System.exit(0);
                        break;
                    default:
                        logger.warn("Unknown argument: {}", args[i]);
                        break;
                }
            }

            TSDBServer server = new TSDBServer(config);
            server.start();

            Thread.currentThread().join();
        } catch (Exception e) {
            logger.error("Failed to start TSDB Server", e);
            System.exit(1);
        }
    }

    private static void printHelp() {
        System.out.println("LSM Time Series Database");
        System.out.println();
        System.out.println("Usage: java -jar lsm-tsdb.jar [options]");
        System.out.println();
        System.out.println("Options:");
        System.out.println("  --data-dir <path>      Data directory (default: data)");
        System.out.println("  --wal-dir <path>       WAL directory (default: data/wal)");
        System.out.println("  --port <port>          HTTP port (default: 8080)");
        System.out.println("  --host <host>          HTTP host (default: 0.0.0.0)");
        System.out.println("  --memtable-size <size> MemTable max size in bytes (default: 16777216)");
        System.out.println("  -h, --help             Show this help message");
    }
}
