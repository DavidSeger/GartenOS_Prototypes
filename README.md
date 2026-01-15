# GardenOS

**A Digital Platform for Assessing and Documenting the Ecological Value of Private Gardens and Public Areas**

GardenOS is a two-layered digital platform designed to support biodiversity documentation in urban environments. It bridges the gap between **citizen contributors** and **ecological experts** through an innovative **walk-and-talk interaction paradigm**.

---

## Prerequisites and API Keys

**Important:** This system requires API keys to function. You must obtain and configure the following before running:

| Service | Purpose | Get Key At |
|---------|---------|------------|
| **Google Gemini** | Speech-to-text transcription | https://ai.google.dev/ |
| **OpenAI ChatGPT** | Object placement planning | https://platform.openai.com/ |

See [Getting Started](#getting-started) for configuration instructions.

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
  - [Mobile Application](#mobile-application-gartenosmobile_20)
  - [Expert System](#expert-system-gartenosexpert)
- [How It Works](#how-it-works)
- [Data Format](#data-format)
- [API Integration](#api-integration)
- [Authors](#authors)

---

## Overview

GardenOS provides two complementary applications for garden mapping:

| Component | Target Users | Purpose |
|-----------|--------------|---------|
| **Mobile App** | Private Citizens | Easy garden documentation via walking and talking |
| **Expert System** | Ecologists and Researchers | Precise spatial analysis and validation |

### The Problem We Solve

```
Traditional GIS Tools                    GardenOS
---------------------                    --------
- Complex polygon drawing                + Walk the boundary
- Technical terminology                  + Describe what you see  
- Desktop-only workflows                 + Mobile-first, in-situ
- Steep learning curve                   + Intuitive interaction
- No expert validation                   + Built-in review system
```

---

## System Architecture

```
+-------------------------------------------------------------------------+
|                          GardenOS Architecture                          |
+-------------------------------------------------------------------------+

+------------------+                              +------------------+
|   MOBILE APP     |                              |  EXPERT SYSTEM   |
|   (Citizens)     |                              |  (Professionals) |
+------------------+                              +------------------+
|                  |                              |                  |
|  +------------+  |      +----------------+      |  +------------+  |
|  | GPS Track  |  |      |                |      |  | Satellite  |  |
|  | Recording  |--+----->|   JSON Data    |<-----+--| Imagery    |  |
|  +------------+  |      |   Exchange     |      |  +------------+  |
|                  |      |                |      |                  |
|  +------------+  |      +-------+--------+      |  +------------+  |
|  | Voice      |  |              |               |  | Polygon    |  |
|  | Recording  |--+--------------+               |  | Editor     |  |
|  +------------+  |              |               |  +------------+  |
|                  |              v               |                  |
|  +------------+  |      +----------------+      |  +------------+  |
|  | Video      |  |      |   External     |      |  | Vegetation |  |
|  | Capture    |  |      |   APIs         |      |  | Placement  |  |
|  +------------+  |      +----------------+      |  +------------+  |
|                  |              |               |                  |
+------------------+              |               +------------------+
                                  |
                    +-------------+-------------+
                    |                           |
              +-----v-----+             +-------v-------+
              |  Google   |             |    OpenAI     |
              |  Gemini   |             |   ChatGPT     |
              | (Speech   |             |  (Object      |
              |  to Text) |             |   Planning)   |
              +-----------+             +---------------+
                    |                           |
                    +-------------+-------------+
                                  |
                        [API KEYS REQUIRED]
```

### Data Flow

```
+-------------------------------------------------------------------------+
|                              DATA FLOW                                   |
+-------------------------------------------------------------------------+

  User                    Mobile App                 Cloud APIs
  ----                    ----------                 ----------
    |                         |                          |
    |  1. Walk & Talk         |                          |
    |------------------------>|                          |
    |                         |                          |
    |                         |  2. Send Audio           |
    |                         |------------------------->| Google Gemini
    |                         |                          |
    |                         |  3. Timestamped          |
    |                         |     Transcript           |
    |                         |<-------------------------|
    |                         |                          |
    |                         |  4. Send Transcript      |
    |                         |     + GPS + Metadata     |
    |                         |------------------------->| OpenAI ChatGPT
    |                         |                          |
    |                         |  5. Object Placements    |
    |                         |     (JSON)               |
    |                         |<-------------------------|
    |                         |                          |
    |  6. View Generated Map  |                          |
    |<------------------------|                          |
    |                         |                          |
    |                         |                          |
                              |
                              v
                   +---------------------+
                   |   Export JSON Map   |
                   +----------+----------+
                              |
                              v
                   +---------------------+
                   |   EXPERT SYSTEM     |
                   |   Import, Review,   |
                   |   and Validate      |
                   +---------------------+
```

---

## Features

### Mobile Application (Citizens)

| Feature | Description |
|---------|-------------|
| **Walk-and-Talk** | Record garden boundaries by simply walking the perimeter |
| **Voice Descriptions** | Describe trees, plants, and features naturally |
| **GPS Corner Marking** | 15-second sampling at each corner for accuracy |
| **Video Recording** | Captures visual context for expert review |
| **LLM Processing** | AI interprets descriptions and places objects |
| **Map Preview** | View generated map before exporting |
| **Error Correction** | Add verbal corrections if needed |

### Expert System (Professionals)

| Feature | Description |
|---------|-------------|
| **Satellite Imagery** | OpenStreetMap integration for any location worldwide |
| **Polygon Drawing** | Precise boundary and subzone definition |
| **Vegetation Placement** | Add trees and plants with size attributes |
| **Import/Export** | JSON-based data exchange with mobile app |
| **Map Validation** | Review citizen-generated maps against aerial imagery |
| **Ground Types** | Define grass, concrete, water, soil zones |

---

## Repository Structure

```
GartenOS_Prototypes/
|
+-- GartenOSExpert/                 # Expert System (Web Application)
|   +-- GardenOS_expert.html        # Main application file (open in browser)
|
+-- GartenOSMobile_2.0/             # Mobile App (Current Version)
|   +-- app/                        # Expo Router pages
|   |   +-- index.tsx               # Home screen
|   |   +-- record.tsx              # Recording screen
|   |   +-- review.tsx              # Map review screen
|   +-- components/                 # Reusable components
|   +-- services/                   # API integrations
|   |   +-- speechToText.ts         # Google Gemini integration
|   |   +-- objectPlanning.ts       # ChatGPT integration
|   +-- utils/                      # Helper functions
|   |   +-- gpsProcessing.ts        # GPS averaging and filtering
|   +-- app.json                    # Expo configuration
|   +-- package.json                # Dependencies
|
+-- GartenOSMobile/                 # Legacy Prototype (Archive only)
```

---

## Getting Started

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18.0 or higher | JavaScript runtime |
| npm or yarn | Latest | Package management |
| Expo CLI | Latest | Mobile development |
| Modern Browser | Chrome, Firefox, or Safari | Expert system |

---

### Mobile Application (GartenOSMobile_2.0)

#### 1. Installation

```bash
# Navigate to mobile app directory
cd GartenOSMobile_2.0

# Install dependencies
npm install
```

#### 2. Configure API Keys

**You must add your API keys before running the app.**

```bash
# Create environment file
cp .env.example .env
```

Edit the `.env` file and add your keys:

```
GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

**Without valid API keys, the speech-to-text and object placement features will not work.**

#### 3. Run the App

```bash
# Start the development server
npx expo start

# Or run on specific platform:
npx expo run:ios      # iOS Simulator
npx expo run:android  # Android Emulator
```

For physical devices, scan the QR code with the Expo Go app.

#### Usage

1. **Start Recording** - Press "Record Garden" and grant permissions
2. **Walk the Boundary** - Walk along edges while describing features aloud
3. **Mark Corners** - Press button and stand still 15 seconds at each corner
4. **Complete** - Press "Stop" and wait for AI processing
5. **Export** - Save JSON map for expert review

---

### Expert System (GartenOSExpert)

#### Running

```bash
# Option 1: Python HTTP server
cd GartenOSExpert
python -m http.server 8000
# Open http://localhost:8000/GardenOS_expert.html

# Option 2: Direct file
# Simply open GardenOS_expert.html in your browser
```

The expert system runs entirely in the browser and does not require API keys.

#### Usage

1. **Search Location** - Enter address to navigate
2. **Draw Boundary** - Click points to define polygon, double-click to close
3. **Add Subzones** - Select ground type and draw
4. **Place Vegetation** - Select size and click to place
5. **Import** - Load JSON maps from mobile app
6. **Export** - Save your work as JSON

---

## How It Works

### The Walk-and-Talk Paradigm

```
+-------------------------------------------------------------------------+
|                       WALK-AND-TALK WORKFLOW                            |
+-------------------------------------------------------------------------+

  Step 1: WALK              Step 2: TALK              Step 3: MARK
  ------------              ------------              ------------
  
     +-------+              "There's a large           Stand still
     | START |               oak tree here,            for 15 sec
     +---+---+               about 5 meters            at each corner
         |                   tall..."                       |
         v                                                  v
    +---------+                                      +-----------+
    |  Walk   |<-- GPS                               |  Average  |
    |  along  |    tracking                          |   GPS     |
    |  edge   |    (1/sec)                           |  readings |
    +---------+                                      +-----------+
         |                    
         v                    
    +-------+                
    |  END  |                
    +-------+                


  Step 4: PROCESS           Step 5: GENERATE          Step 6: EXPORT
  ---------------           ----------------          --------------
  
   Audio -----> Gemini      Transcript +              JSON file
                API         GPS data -----> ChatGPT   exported to
                  |              |          API       Expert System
                  v              v            |            |
            Timestamped     Combined          v            v
            Transcript      Payload      JSON Map     Expert reviews
                                         Generated    and validates
```

### GPS Corner Marking (15-Second Sampling)

The 15-second sampling window:
- Collects multiple GPS readings and averages them
- Reduces positional error from signal noise
- Handles multipath interference (reflections from trees and buildings)
- Filters readings with accuracy worse than 5 meters

```
Raw GPS Readings (15 seconds):
------------------------------------------------------------

   X  47.4231, 9.3742  (+/- 8m)  <-- filtered out (> 5m)
   *  47.4233, 9.3745  (+/- 3m)  <-- kept
   *  47.4232, 9.3744  (+/- 2m)  <-- kept
   *  47.4234, 9.3746  (+/- 4m)  <-- kept
   X  47.4228, 9.3740  (+/- 7m)  <-- filtered out (> 5m)
   *  47.4233, 9.3745  (+/- 3m)  <-- kept
   ...

------------------------------------------------------------
   Averaged Result: 47.4233, 9.3745  (+/- 2.5m)
------------------------------------------------------------
```

---

## Data Format

GardenOS uses JSON for data exchange, chosen for:
- Human-readability during development and debugging
- Straightforward parsing in both web and mobile environments

### Example Map JSON

```json
{
  "metadata": {
    "created": "2025-11-15T14:32:00Z",
    "source": "mobile",
    "version": "2.0"
  },
  "boundary": {
    "type": "polygon",
    "coordinates": [
      [47.4233, 9.3745],
      [47.4235, 9.3752],
      [47.4228, 9.3755],
      [47.4225, 9.3748]
    ]
  },
  "subzones": [
    {
      "id": "zone_1",
      "type": "grass",
      "coordinates": []
    }
  ],
  "vegetation": [
    {
      "id": "tree_1",
      "type": "tree",
      "size": "large",
      "position": { "lat": 47.4230, "lng": 9.3750 },
      "description": "oak tree, approximately 5 meters tall"
    }
  ]
}
```

### Ground Types

| Type | Description |
|------|-------------|
| `grass` | Lawn, meadow |
| `concrete` | Paved areas, paths |
| `water` | Ponds, streams |
| `soil` | Bare earth, garden beds |

### Vegetation Sizes

| Size | Typical Height |
|------|----------------|
| `small` | Less than 2m |
| `medium` | 2-5m |
| `large` | Greater than 5m |

---

## API Integration

### Google Gemini (Speech-to-Text)

Requires `GOOGLE_GEMINI_API_KEY` in `.env`

```typescript
// services/speechToText.ts
async function transcribeAudio(audioBlob: Blob): Promise<TranscriptSegment[]> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GOOGLE_GEMINI_API_KEY}`,
      'Content-Type': 'audio/wav'
    },
    body: audioBlob
  });
  return response.json();
}
```

### OpenAI ChatGPT (Object Planning)

Requires `OPENAI_API_KEY` in `.env`

```typescript
// services/objectPlanning.ts
async function planObjects(input: PlanningInput): Promise<VegetationObject[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: PLANNING_PROMPT },
      { role: 'user', content: JSON.stringify(input) }
    ]
  });
  return JSON.parse(response.choices[0].message.content);
}
```

---

## Authors

| Author | Email | Institution |
|--------|-------|-------------|
| David Elia Egon Seger | david.seger@student.unisg.ch | University of St. Gallen |
| Youssef Riad | youssef.riad@student.unisg.ch | University of St. Gallen |

---

## Acknowledgements

- **Gruenes Gallustal** - Partner organization for urban biodiversity in St. Gallen
- **OpenStreetMap** - Geographic data
- **Leaflet.js** - Interactive map library