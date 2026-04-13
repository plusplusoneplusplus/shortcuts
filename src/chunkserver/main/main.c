/*
 * main.c — Chunkserver entry point
 *
 * Initializes the chunk server and I/O layer, then runs the event
 * loop until SIGINT or QUIT command.
 *
 * Usage: chunkserver [-p port]
 */

#include "server_io.h"
#include "../lib/chunk_server.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <errno.h>

#define DEFAULT_PORT 9001

static volatile sig_atomic_t g_running = 1;

static void signal_handler(int sig) {
    (void)sig;
    g_running = 0;
}

int main(int argc, char **argv) {
    int port = DEFAULT_PORT;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-p") == 0 && i + 1 < argc) {
            port = atoi(argv[++i]);
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: chunkserver [-p port]\n"
                   "  -p port   TCP listen port (default: %d)\n"
                   "  -h        Show this help\n"
                   "\nAdmin commands (stdin):\n"
                   "  PUT <32-hex-guid> <hex-data>\n"
                   "  GET <32-hex-guid>\n"
                   "  DELETE <32-hex-guid>\n"
                   "  LIST\n"
                   "  STATS\n"
                   "  QUIT\n", DEFAULT_PORT);
            return 0;
        }
    }

    signal(SIGINT,  signal_handler);
    signal(SIGTERM, signal_handler);

    ChunkServer server;
    if (SNAP_FAILED(ChunkServer_Init(&server))) {
        fprintf(stderr, "Failed to initialize chunk server\n");
        return 1;
    }

    ServerIO io;
    if (ServerIO_Init(&io, port) != 0) {
        fprintf(stderr, "Failed to listen on port %d: %s\n",
                port, strerror(errno));
        ChunkServer_Destroy(&server);
        return 1;
    }

    printf("Chunk server listening on port %d\n", port);
    printf("Type QUIT or Ctrl-C to stop.\n");

    while (g_running && io.running)
        ServerIO_Run(&io, &server);

    printf("\nShutting down...\n");
    ServerIO_Destroy(&io);
    ChunkServer_Destroy(&server);
    printf("Server stopped.\n");
    return 0;
}
