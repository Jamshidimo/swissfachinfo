#!/bin/bash
# Download import files from Google Drive
# Usage: bash scripts/download-from-gdrive.sh

set -e

DATA_DIR="data"
mkdir -p "$DATA_DIR"

# Install gdown if not present
if ! command -v gdown &> /dev/null; then
    echo "Installing gdown..."
    pip install --quiet gdown
fi

# SQLite database (~190 MB)
SQLITE_ID="1amlZUNbpc8B4kpCo3Hd91qDuyza5olV0"
SQLITE_FILE="$DATA_DIR/swissmedic_fi_de_sections_v3.db"

if [ -f "$SQLITE_FILE" ] && [ $(stat -c%s "$SQLITE_FILE" 2>/dev/null || stat -f%z "$SQLITE_FILE" 2>/dev/null) -gt 1000000 ]; then
    echo "swissmedic_fi_de_sections_v3.db already exists, skipping."
else
    echo "Downloading swissmedic_fi_de_sections_v3.db (~190 MB)..."
    rm -f "$SQLITE_FILE"
    gdown "$SQLITE_ID" -O "$SQLITE_FILE"
    echo "Done: $(du -h "$SQLITE_FILE" | cut -f1)"
fi

# XML file (~2 GB)
XML_ID="129FpUXoxjkYQ1JoMnMCJVIt2VRHDzuIx"
XML_FILE="$DATA_DIR/AipsDownload_20250326.xml"

if [ -f "$XML_FILE" ] && [ $(stat -c%s "$XML_FILE" 2>/dev/null || stat -f%z "$XML_FILE" 2>/dev/null) -gt 1000000 ]; then
    echo "AipsDownload_20250326.xml already exists, skipping."
else
    echo "Downloading AipsDownload_20250326.xml (~2 GB)..."
    rm -f "$XML_FILE"
    gdown "$XML_ID" -O "$XML_FILE"
    echo "Done: $(du -h "$XML_FILE" | cut -f1)"
fi

echo ""
echo "All files in ./$DATA_DIR/:"
ls -lh "$DATA_DIR/"
