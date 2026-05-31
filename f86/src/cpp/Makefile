EMSCRIPTEN_DIR = C:\emsdk\upstream\emscripten
EMCC = emcc

CXXFLAGS = -std=c++17 -O2 -Wall
LDFLAGS = -s WASM=1 \
          -s EXPORTED_FUNCTIONS='["_malloc", "_free", "_create_pdf_parser", "_destroy_pdf_parser", "_get_page_count", "_get_page", "_free_page", "_get_page_width", "_get_page_height", "_get_path_count", "_get_path", "_free_path", "_get_path_point_count", "_get_path_point_type", "_get_path_point_x", "_get_path_point_y", "_get_bezier_cp1x", "_get_bezier_cp1y", "_get_bezier_cp2x", "_get_bezier_cp2y", "_get_path_fill_type", "_get_path_fill_color", "_get_path_gradient", "_get_path_line_width", "_get_path_mode", "_get_gradient_type", "_get_gradient_x1", "_get_gradient_y1", "_get_gradient_x2", "_get_gradient_y2", "_get_gradient_r1", "_get_gradient_r2", "_get_gradient_stop_count", "_get_gradient_stop_offset", "_get_gradient_stop_color", "_get_text_count", "_get_text_item", "_free_text_item", "_get_text_content", "_get_text_x", "_get_text_y", "_get_text_font_size", "_get_text_color"]' \
          -s EXTRA_EXPORTED_RUNTIME_METHODS='["UTF8ToString", "cwrap", "getValue"]' \
          -s ALLOW_MEMORY_GROWTH=1 \
          -s MODULARIZE=1 \
          -s EXPORT_NAME="Module"

SRCDIR = .
BUILDDIR = build

SOURCES = $(wildcard $(SRCDIR)/*.cpp)
TARGET = $(BUILDDIR)/pdf_renderer.js

.PHONY: all clean

all: $(TARGET)

$(BUILDDIR):
	if not exist $(BUILDDIR) mkdir $(BUILDDIR)

$(TARGET): $(SOURCES) | $(BUILDDIR)
	$(EMCC) $(CXXFLAGS) $(LDFLAGS) -o $@ $(SOURCES)

clean:
	if exist $(BUILDDIR) rmdir /s /q $(BUILDDIR)
