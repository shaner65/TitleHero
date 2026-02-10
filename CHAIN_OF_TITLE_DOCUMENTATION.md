# Chain of Title Feature Documentation

## Overview
The Chain of Title feature automatically traces the ownership history of a property through a chronological sequence of recorded documents. It leverages AI to analyze document relationships and generate a comprehensive title chain narrative.

## Architecture

### Backend (`server/routes/chainOfTitle.js`)

#### Endpoint: `GET /api/chain-of-title/:documentID`

**Parameters:**
- `documentID` (integer, required): The document ID to retrieve the chain for

**Response:**
```json
{
  "propertyInfo": {
    "documentID": 123,
    "legalDescription": "Lot 1, Block 2...",
    "address": "123 Main St",
    "filingDate": "2022-01-15",
    "grantors": "John Doe",
    "grantees": "Jane Smith",
    "countyID": 1,
    "countyName": "Washington"
  },
  "chainDocs": [
    {
      "documentID": 120,
      "filingDate": "2020-05-10",
      "instrumentType": "Warranty Deed",
      "book": 5000,
      "volume": 1,
      "page": 50,
      "grantors": "Original Owner",
      "grantees": "John Doe"
    },
    {
      "documentID": 123,
      "filingDate": "2022-01-15",
      "instrumentType": "Warranty Deed",
      "book": 5100,
      "volume": 2,
      "page": 150,
      "grantors": "John Doe",
      "grantees": "Jane Smith"
    }
  ],
  "analysis": {
    "narrative": "On 2020-05-10, Original Owner transferred the property to John Doe via Warranty Deed...",
    "analysis": "The chain shows a clear transfer of ownership. Both documents are properly recorded.",
    "concerns": "No concerns identified.",
    "source": "ai"
  },
  "documentCount": 2
}
```

#### AI Analysis Functions

**`buildHeuristicChainNarrative(chainDocs)`**
- Fallback narrative generation when AI is unavailable
- Creates human-readable ownership transfer descriptions
- Uses available document fields (dates, parties, instrument types, book references)
- Returns simple text narrative

**`generateChainAnalysis(chainDocs, propertyInfo)`**
- Uses OpenAI GPT-4.1-mini with structured JSON schema
- Analyzes property ownership chain
- Generates narrative, analysis, and identifies concerns
- Returns structured analysis with source indicator (AI or heuristic)
- Gracefully falls back to heuristic on API errors

#### Chain Discovery Logic

**Legal Description Match (Primary):**
- Extracts first 50 characters of the legal description
- Searches all documents with matching description in same county
- Orders results chronologically by filing date

**Address Match (Fallback):**
- If no legal description available, uses property address
- Searches documents with matching address in same county
- Orders results chronologically

### Frontend

#### Component: `ChainOfTitle.tsx`

**Props:**
```typescript
interface ChainOfTitleProps {
  documentID: number;
}
```

**Features:**
- Collapsible header with toggle functionality
- Displays AI-generated chain analysis
- Shows document sequence with visual timeline
- Responsive design for all screen sizes
- Loading states and error handling

**Display Sections:**
1. **Ownership History**: AI-generated narrative of transfers
2. **Title Analysis**: Analysis of chain integrity and concerns
3. **Concerns Alert**: Flags any issues in the chain
4. **Document Sequence**: Chronological timeline with:
   - Document number
   - Filing date
   - Instrument type (color-coded badge)
   - Book/Volume/Page reference
   - Grantor (From) and Grantee (To)
   - Visual connectors between documents

#### Styling: `ChainOfTitle.css`

**Features:**
- Gradient header with purple theme
- Expandable/collapsible UI with smooth animations
- Timeline visualization with numbered steps
- Responsive breakpoints for mobile (768px, 480px)
- Color-coded concerns warning section
- Bouncing connector animation between documents

### Integration

**Where It Appears:**
- Results component (`Results.tsx`)
- Displays automatically for each search result below the summary section
- Uses same document ID as parent result

**Data Flow:**
```
Results.tsx (displays search results)
  ↓
ChainOfTitle.tsx (imported for each result)
  ↓
fetch(/api/chain-of-title/:documentID)
  ↓
server/routes/chainOfTitle.js
  ↓
Database queries (Document, Party, County tables)
  ↓
AI Analysis (OpenAI API)
  ↓
JSON Response with chain data and analysis
  ↓
UI renders timeline and narrative
```

## Database Usage

**Tables Queried:**
- `Document`: Main document records with legal description, dates, book references
- `Party`: Grantors/Grantees for each document
- `County`: County information for property context

**Key Queries:**
1. Fetch initial document with aggregated grantors/grantees
2. Find all related documents by legal description or address
3. Sort chronologically by filing date
4. Aggregate parties by role (Grantor/Grantee)

## AI Processing

**Model:** GPT-4.1-mini

**Inputs to AI:**
- Chronologically sorted documents for the property
- Grantor and Grantee names for each step
- Document types and dates
- Legal description and address

**AI Tasks:**
1. Generate clear ownership transfer narrative
2. Analyze chain continuity
3. Identify any gaps or concerns in the chain
4. Assess title chain completeness

**Output Schema:**
```json
{
  "narrative": "string describing ownership transfers",
  "analysis": "string analyzing chain integrity",
  "concerns": "string describing any identified concerns"
}
```

## Error Handling

**Graceful Degradation:**
- If AI API call fails, falls back to heuristic narrative generation
- Returns metadata indicating source (AI vs. heuristic)
- UI displays appropriate loading/error states

**Edge Cases:**
- No legal description or address: Empty chain returned
- No related documents: Message indicates no chain found
- API errors: Uses fallback heuristic automatically
- Database errors: Returns 500 with error message

## Usage Examples

### For a Property with Clear Chain
```
Title Ownership Chain - Property at 123 Main St

1. 2020-05-10: John Smith → Jane Doe (Warranty Deed, Book 5000/1/50)
2. 2022-01-15: Jane Doe → ABC Trust (Special Warranty Deed, Book 5100/2/150)
3. 2024-03-20: ABC Trust → Current Owner LLC (Warranty Deed, Book 5200/3/75)

Analysis: Clear chain with no gaps. All documents properly recorded.
```

### For a Property with Concerns
```
Title Ownership Chain - Property at 456 Oak Ave

1. 2015-06-01: Original Owner → John Smith (Deed of Trust)
   [GAP: 5 years]
2. 2020-09-15: Jane Doe → Current Owner (Warranty Deed)

Analysis: Gap in chain suggests missing documents or unclear ownership transfer.
Concerns: Unable to identify how John Smith transferred to Jane Doe.
```

## Performance Considerations

- Chain queries limited to same county to reduce result set
- Legal description limited to first 50 characters for matching
- AI analysis only performed if API key configured
- Component only fetches chain once on mount
- Collapsible design reduces initial rendering cost

## Future Enhancements

1. **Chain Gap Detection**: Automatically identify missing documents
2. **Title Insurance Integration**: Link to title insurance policies
3. **Defect Analysis**: Flag potential title defects
4. **Export Functionality**: Generate chain of title reports
5. **Timeline Visualization**: Interactive visual timeline
6. **Multiple Chains**: Handle properties with multiple ownership lines
7. **Caching**: Store chains for frequently queried properties

## Testing Checklist

- [ ] Display chain for document with multiple related documents
- [ ] Display chain for document with no related documents
- [ ] AI analysis returns proper JSON structure
- [ ] Fallback to heuristic when AI API fails
- [ ] Responsive design on mobile (480px, 768px)
- [ ] Expandable/collapsible UI works correctly
- [ ] Document sequence displays in chronological order
- [ ] Parties (grantors/grantees) display correctly
- [ ] Color-coded document types render properly
- [ ] No console errors in browser

## Configuration

**Required Environment Variables:**
- `OPENAI_API_KEY`: For AI analysis (optional, fallback available)

**API Endpoint:**
- Default: `GET /api/chain-of-title/:documentID`

## Troubleshooting

### Chain Not Displaying
- Check that document has `legalDescription` or `address` field populated
- Verify related documents exist in the database with matching description/address
- Check browser console for fetch errors

### AI Analysis Not Working
- Verify `OPENAI_API_KEY` is set in environment
- Check API quota and rate limits
- Fallback heuristic should still generate basic chain

### Performance Issues
- Chain queries may be slow if many documents share same description
- Consider indexing `Document.legalDescription` for faster queries
- Implement caching for frequently accessed chains

## Files Modified

- `server/routes/chainOfTitle.js` - NEW
- `server/index.js` - Added chainOfTitle route import
- `client/src/pages/Dashboard/ResultsComponents/ChainOfTitle.tsx` - NEW
- `client/src/pages/Dashboard/ResultsComponents/ChainOfTitle.css` - NEW
- `client/src/pages/Dashboard/ResultsComponents/Results.tsx` - Added ChainOfTitle import and component
