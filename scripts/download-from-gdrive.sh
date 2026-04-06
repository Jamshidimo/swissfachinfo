#!/bin/bash
# Download import files from Google Drive using curl
# Usage: bash scripts/download-from-gdrive.sh

set -e

DATA_DIR="data"
mkdir -p "$DATA_DIR"

download_gdrive() {
    local FILE_ID="$1"
    local OUTPUT="$2"
    local DESC="$3"

    if [ -f "$OUTPUT" ] && [ "$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT" 2>/dev/null)" -gt 1000000 ]; then
        echo "$DESC already exists ($(du -h "$OUTPUT" | cut -f1)), skipping."
        return
    fi

    echo "Downloading $DESC..."
    rm -f "$OUTPUT"

    # Google Drive large file download with confirmation bypass
    curl -L \
        -o "$OUTPUT" \
        --progress-bar \
        -H "User-Agent: Mozilla/5.0" \
        "https://drive.google.com/uc?export=download&confirm=t&id=${FILE_ID}"

    local SIZE=$(du -h "$OUTPUT" | cut -f1)
    echo "Done: $SIZE"
}

# SQLite database
download_gdrive \
    "1amlZUNbpc8B4kpCo3Hd91qDuyza5olV0" \
    "$DATA_DIR/swissmedic_fi_de_sections_v3.db" \
    "swissmedic_fi_de_sections_v3.db (~190 MB)"

# XML file
download_gdrive \
    "129FpUXoxjkYQ1JoMnMCJVIt2VRHDzuIx" \
    "$DATA_DIR/AipsDownload_20250326.xml" \
    "AipsDownload_20250326.xml (~2 GB)"

echo ""
echo "All files in ./$DATA_DIR/:"
ls -lh "$DATA_DIR/"
