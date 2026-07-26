# Category Configuration

This project uses a simple text-based configuration file to define CAN message categories.

## Configuration File

Location: `src/assets/categories.txt`

## Format

```
CategoryName,TailwindColorClass,MessageIDs
```

### Components

- **CategoryName**: Display name for the category (e.g., "VCU", "BMS", "ACCU")
- **TailwindColorClass**: Tailwind CSS background color class (e.g., "bg-purple-500", "bg-sky-400")
- **MessageIDs**: Comma-separated list of CAN message IDs or ranges

### Message ID Formats

- **Individual IDs**: Single numbers (e.g., `256`, `512`)
- **Ranges**: Hyphen-separated (e.g., `100-110` includes 100, 101, 102, ..., 110)
- **Mixed**: Combine both (e.g., `1,2,100-110,256`)

### Comments

Lines starting with `#` are treated as comments and ignored.

## Example Configuration

This mirrors the current `src/assets/categories.txt`:

```txt
# CAN Message Category Configuration
# Format: CategoryName,TailwindColorClass,MessageIDs
# Message IDs can be individual numbers or ranges (e.g., 100-110)
# Lines starting with # are comments

VCU,bg-sky-400,192-194
BMS,bg-orange-400,512,513
INV,bg-green-400,256,257
SENSORS,bg-purple-500,768
COOLING,bg-blue-600,1280
ACCU,bg-red-500,1006-1055
```

## Tailwind Color Classes

Common Tailwind background color classes you can use:

- `bg-purple-500` - Purple
- `bg-sky-400` - Light Blue
- `bg-orange-400` - Orange
- `bg-green-400` - Green
- `bg-red-500` - Red
- `bg-blue-500` - Blue
- `bg-yellow-400` - Yellow
- `bg-pink-500` - Pink
- `bg-indigo-500` - Indigo

## Default Category

Messages that don't match any configured category will be assigned to "NO CAT" with a `bg-blue-500` color.

## Usage in Code

Categories are automatically loaded and parsed at build time. No code changes are needed to add or modify categories - just edit the `categories.txt` file.

The category system is used by:
- `src/components/DataCard.tsx` - Card view
- `src/components/DataRow.tsx` - List/table view
- `src/config/categories.ts` - Parser and utility functions
