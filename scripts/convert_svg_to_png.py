#!/usr/bin/env python3
"""
Smart SVG to PNG converter for VS Code extensions
Converts SVG icons to PNG format with proper sizing for marketplace requirements
"""

import sys
import os
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are available"""
    try:
        import cairosvg
        return True, "cairosvg"
    except ImportError:
        pass

    try:
        from PIL import Image
        import io
        # Try to import wand (ImageMagick Python binding)
        from wand.image import Image as WandImage
        return True, "wand"
    except ImportError:
        pass

    try:
        import subprocess
        # Check if rsvg-convert is available
        result = subprocess.run(['rsvg-convert', '--version'],
                              capture_output=True, text=True)
        if result.returncode == 0:
            return True, "rsvg-convert"
    except FileNotFoundError:
        pass

    try:
        import subprocess
        # Check if ImageMagick convert is available
        result = subprocess.run(['convert', '-version'],
                              capture_output=True, text=True)
        if result.returncode == 0:
            return True, "imagemagick"
    except FileNotFoundError:
        pass

    return False, None

def convert_with_cairosvg(svg_path, png_path, size=128):
    """Convert using cairosvg library"""
    import cairosvg

    print(f"Converting using cairosvg: {svg_path} -> {png_path} ({size}x{size})")
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(png_path),
        output_width=size,
        output_height=size
    )
    return True

def convert_with_wand(svg_path, png_path, size=128):
    """Convert using Wand (ImageMagick Python binding)"""
    from wand.image import Image as WandImage

    print(f"Converting using Wand/ImageMagick: {svg_path} -> {png_path} ({size}x{size})")
    with WandImage(filename=str(svg_path)) as img:
        img.format = 'png'
        img.resize(size, size)
        img.save(filename=str(png_path))
    return True

def convert_with_rsvg(svg_path, png_path, size=128):
    """Convert using rsvg-convert command line tool"""
    import subprocess

    print(f"Converting using rsvg-convert: {svg_path} -> {png_path} ({size}x{size})")
    cmd = [
        'rsvg-convert',
        '--width', str(size),
        '--height', str(size),
        '--output', str(png_path),
        str(svg_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False
    return True

def convert_with_imagemagick(svg_path, png_path, size=128):
    """Convert using ImageMagick convert command"""
    import subprocess

    print(f"Converting using ImageMagick: {svg_path} -> {png_path} ({size}x{size})")
    cmd = [
        'convert',
        '-background', 'transparent',
        '-size', f'{size}x{size}',
        str(svg_path),
        str(png_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        return False
    return True

def install_suggestion(method):
    """Provide installation suggestions for missing dependencies"""
    suggestions = {
        "cairosvg": "pip install cairosvg",
        "wand": "pip install Wand (requires ImageMagick to be installed)",
        "rsvg-convert": "brew install librsvg (macOS) or apt-get install librsvg2-bin (Ubuntu)",
        "imagemagick": "brew install imagemagick (macOS) or apt-get install imagemagick (Ubuntu)"
    }

    print(f"\nTo use this method, install: {suggestions.get(method, method)}")

def main():
    # Default paths
    svg_path = Path("resources/icons/shortcuts.svg")
    png_path = Path("resources/icons/shortcuts.png")
    size = 128  # VS Code marketplace recommended size

    # Parse command line arguments
    if len(sys.argv) > 1:
        svg_path = Path(sys.argv[1])
    if len(sys.argv) > 2:
        png_path = Path(sys.argv[2])
    if len(sys.argv) > 3:
        size = int(sys.argv[3])

    # Check if SVG file exists
    if not svg_path.exists():
        print(f"Error: SVG file not found: {svg_path}")
        print(f"Usage: {sys.argv[0]} [svg_input] [png_output] [size]")
        print(f"Example: {sys.argv[0]} icon.svg icon.png 128")
        sys.exit(1)

    # Create output directory if it doesn't exist
    png_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Converting SVG to PNG:")
    print(f"  Input: {svg_path}")
    print(f"  Output: {png_path}")
    print(f"  Size: {size}x{size}px")
    print()

    # Check available conversion methods
    has_deps, method = check_dependencies()

    if not has_deps:
        print("No suitable conversion tools found!")
        print("\nYou can install one of these options:")
        install_suggestion("cairosvg")
        install_suggestion("wand")
        install_suggestion("rsvg-convert")
        install_suggestion("imagemagick")
        sys.exit(1)

    # Try to convert using available method
    success = False

    try:
        if method == "cairosvg":
            success = convert_with_cairosvg(svg_path, png_path, size)
        elif method == "wand":
            success = convert_with_wand(svg_path, png_path, size)
        elif method == "rsvg-convert":
            success = convert_with_rsvg(svg_path, png_path, size)
        elif method == "imagemagick":
            success = convert_with_imagemagick(svg_path, png_path, size)

    except Exception as e:
        print(f"Error during conversion: {e}")
        success = False

    if success and png_path.exists():
        file_size = png_path.stat().st_size
        print(f"\n✅ Conversion successful!")
        print(f"   Output: {png_path}")
        print(f"   Size: {file_size:,} bytes")
        print(f"   Dimensions: {size}x{size}px")

        # Update package.json to use PNG
        package_json = Path("package.json")
        if package_json.exists():
            content = package_json.read_text()
            if '"icon": "resources/icons/shortcuts.svg"' in content:
                new_content = content.replace(
                    '"icon": "resources/icons/shortcuts.svg"',
                    '"icon": "resources/icons/shortcuts.png"'
                )
                package_json.write_text(new_content)
                print(f"   Updated package.json to reference PNG icon")

    else:
        print(f"\n❌ Conversion failed using {method}")
        sys.exit(1)

if __name__ == "__main__":
    main()