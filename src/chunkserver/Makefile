# Chunkserver Makefile
#
# Build targets:
#   make          — build the server binary
#   make test     — compile and run all tests
#   make clean    — remove all build artifacts
#
# Options:
#   V=1           — verbose build output

CC      = gcc
CFLAGS  = -Wall -Wextra -Werror -std=c11 -g -O2 -Ilib
LDFLAGS =

# Quiet by default
V ?= 0
ifeq ($(V),0)
  Q = @
  ECHO = @echo
else
  Q =
  ECHO = @echo
endif

# ── Source files ──────────────────────────────────────────────────────

LIB_SRCS = lib/snap_posix_channel.c \
           lib/snap_posix_memory.c  \
           lib/chunk.c              \
           lib/chunk_meta.c         \
           lib/chunk_store.c        \
           lib/chunk_ops.c          \
           lib/chunk_server.c

MAIN_SRCS = main/main.c main/server_io.c

LIB_OBJS  = $(LIB_SRCS:.c=.o)
MAIN_OBJS = $(MAIN_SRCS:.c=.o)

BIN = chunkserver

# ── Test binaries ─────────────────────────────────────────────────────

TEST_NAMES = test_chunk test_chunk_meta test_snap_channel test_snap_memory \
             test_chunk_store test_chunk_ops test_chunk_server
TEST_BINS  = $(addprefix test/,$(TEST_NAMES))

# ── Phony targets ─────────────────────────────────────────────────────

.PHONY: all test clean

all: $(BIN)

# ── Server binary ─────────────────────────────────────────────────────

$(BIN): $(LIB_OBJS) $(MAIN_OBJS)
	$(ECHO) "  LINK  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

lib/%.o: lib/%.c
	$(ECHO) "  CC    $<"
	$(Q)$(CC) $(CFLAGS) -c -o $@ $<

main/%.o: main/%.c
	$(ECHO) "  CC    $<"
	$(Q)$(CC) $(CFLAGS) -Imain -c -o $@ $<

# ── Tests ─────────────────────────────────────────────────────────────

test: $(TEST_BINS)
	@echo ""
	@echo "=== Running all tests ==="
	@echo ""
	@failed=0; total=0; \
	for t in $(TEST_BINS); do \
		total=$$((total + 1)); \
		./$$t || { failed=$$((failed + 1)); echo "FAIL: $$t"; }; \
		echo ""; \
	done; \
	echo "=== $$total test suites, $$((total - failed)) passed, $$failed failed ==="; \
	exit $$failed

# Each test binary links against the lib objects it needs

test/test_chunk: test/test_chunk.c lib/chunk.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_chunk_meta: test/test_chunk_meta.c lib/chunk_meta.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_snap_channel: test/test_snap_channel.c lib/snap_posix_channel.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_snap_memory: test/test_snap_memory.c lib/snap_posix_memory.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_chunk_store: test/test_chunk_store.c lib/chunk_store.o lib/chunk_meta.o lib/chunk.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_chunk_ops: test/test_chunk_ops.c lib/chunk_ops.o lib/chunk_store.o lib/chunk_meta.o lib/chunk.o lib/snap_posix_channel.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

test/test_chunk_server: test/test_chunk_server.c lib/chunk_server.o lib/chunk_ops.o lib/chunk_store.o lib/chunk_meta.o lib/chunk.o lib/snap_posix_channel.o
	$(ECHO) "  TEST  $@"
	$(Q)$(CC) $(CFLAGS) -o $@ $^

# ── Clean ─────────────────────────────────────────────────────────────

clean:
	$(Q)rm -f $(BIN) $(LIB_OBJS) $(MAIN_OBJS) $(TEST_BINS)
	@echo "  Cleaned."
