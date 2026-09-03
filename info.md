# Frigate Delivery Card

See which delivery companies visited your home, when they arrived, and what happened. Frigate Delivery Card turns Frigate events into a browsable Home Assistant history with snapshots, inline video clips, company filters, a reel, and a timeline view.

The card and graphical editor support English and German and automatically follow each user's Home Assistant profile language.

![Screenshot of the Frigate Delivery Card](https://raw.githubusercontent.com/thomasgregg/frigate-delivery-card/main/docs/screenshot.png)

## Sections dashboard sizing

Automatic height is the default. It preserves the natural 16:9 snapshot or video area and lets company filters wrap.

| View | Default size | Minimum size |
|---|---:|---:|
| Reel | 12 columns × automatic height | 6 columns × 4 rows |
| Timeline | 12 columns × automatic height | 6 columns × 3 rows |

With a fixed row height, the card uses a compact layout: the media area takes the remaining height, filters and thumbnails scroll horizontally, and controls scale with the card. These minimums prevent clipped or unreadable size combinations. Width and height are independent in Home Assistant, so a wide card still needs the minimum row count.

For installation, configuration examples, Frigate settings, and troubleshooting, see the [complete README](https://github.com/thomasgregg/frigate-delivery-card#readme).
