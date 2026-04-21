#!/usr/bin/env bash
# Generate the before/after animated GIF for the README.
# Requires: imagemagick (brew install imagemagick)
#
# Usage: ./screenshots/generate-gif.sh
#
# Inputs:  screenshots/body-before.png, screenshots/body-after.png
# Output:  screenshots/before-after.gif

set -euo pipefail
cd "$(dirname "$0")"

FONT="/System/Library/Fonts/HelveticaNeue.ttc"
# Fallback: on Linux, try fc-match
if [ ! -f "$FONT" ]; then
  FONT=$(fc-match "sans:weight=bold" --format='%{file}')
fi

# 1. Normalize to the same canvas size (use the max of each dimension)
W=$(magick identify -format '%w\n' body-before.png body-after.png | sort -rn | head -1)
H=$(magick identify -format '%h\n' body-before.png body-after.png | sort -rn | head -1)

magick body-before.png -gravity center -background '#1c2128' -extent "${W}x${H}" _before.png
magick body-after.png  -gravity center -background '#1c2128' -extent "${W}x${H}" _after.png

# 2. Add labels
magick _before.png \
  \( -size 160x40 xc:none -fill '#da3633' -draw "roundrectangle 0,0 159,39 12,12" \
     -font "$FONT" -weight 700 -pointsize 22 -fill white -gravity center -annotate +0+0 "BEFORE" \) \
  -gravity northeast -geometry +12+12 -composite \
  _before_labeled.png

magick _after.png \
  \( -size 140x40 xc:none -fill '#238636' -draw "roundrectangle 0,0 139,39 12,12" \
     -font "$FONT" -weight 700 -pointsize 22 -fill white -gravity center -annotate +0+0 "AFTER" \) \
  -gravity northeast -geometry +12+12 -composite \
  _after_labeled.png

# 3. Generate crossfade frames (8 steps each direction)
STEPS=8
for i in $(seq 0 $((STEPS - 1))); do
  pct=$(echo "scale=2; $i / ($STEPS - 1) * 100" | bc)
  magick _before_labeled.png _after_labeled.png \
    -define "compose:args=$pct" -compose dissolve -composite "_fade_fwd_$i.png"
  magick _after_labeled.png _before_labeled.png \
    -define "compose:args=$pct" -compose dissolve -composite "_fade_rev_$i.png"
done

# 4. Assemble: hold 2s, crossfade 0.4s, hold 2s, crossfade 0.4s
FWD_FRAMES=()
REV_FRAMES=()
for i in $(seq 0 $((STEPS - 1))); do
  FWD_FRAMES+=("_fade_fwd_$i.png")
  REV_FRAMES+=("_fade_rev_$i.png")
done

magick -loop 0 \
  -delay 200 _before_labeled.png \
  -delay 5 "${FWD_FRAMES[@]}" \
  -delay 200 _after_labeled.png \
  -delay 5 "${REV_FRAMES[@]}" \
  -layers optimize \
  before-after.gif

# 5. Clean up
rm -f _before.png _after.png _before_labeled.png _after_labeled.png _fade_fwd_*.png _fade_rev_*.png

echo "Generated before-after.gif ($(du -h before-after.gif | cut -f1))"
