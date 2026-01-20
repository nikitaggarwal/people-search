import { NextRequest, NextResponse } from 'next/server';
import Exa from 'exa-js';
import { Client } from '@hubspot/api-client';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  // Initialize Exa at runtime, not build time
  const exa = new Exa(process.env.EXA_API_KEY);
  
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Use GPT to intelligently parse the query and generate search variations
    const searchIntelligence = await parseQueryWithGPT(query);
    
    const companyFromQuery = searchIntelligence.company || extractCompanyFromQuery(query);
    const jobTitleFromQuery = searchIntelligence.jobTitle || extractJobTitleFromQuery(query);
    const titleVariations = searchIntelligence.titleVariations || [];
    
    console.log(`[DEBUG] GPT parsed query: company="${companyFromQuery}", title="${jobTitleFromQuery}", variations:`, titleVariations);

    // Use Exa to search for people profiles with LinkedIn URLs
    // Make query more specific about the company to get better matches
    const searchQuery = companyFromQuery 
      ? `${query} currently works at ${companyFromQuery} linkedin profile`
      : `${query} linkedin profile`;
    
    const response = await exa.searchAndContents(
      searchQuery,
      {
        type: 'auto',
        numResults: 100, // Increased to catch more potential matches
        text: { maxCharacters: 500 },
        highlights: {
          highlightsPerUrl: 5,
          numSentences: 3,
        },
        includeDomains: ['linkedin.com/in'],
      }
    );

    // Filter to only include actual LinkedIn profiles (/in/ URLs)
    // Exclude: job postings, company pages, posts, etc.
    const filteredResults = response.results.filter((result: any) => {
      const url = result.url || '';
      return url.includes('linkedin.com/in/') && !url.includes('/jobs/') && !url.includes('/company/');
    });
    
    console.log(`[DEBUG] Exa returned ${response.results.length} results, ${filteredResults.length} after filtering`);

    // Transform the results to our profile format
    const profiles = filteredResults.map((result: any) => {
      return extractProfileData(result, companyFromQuery);
    });

    // Filter to only current employees with matching job title
    const finalProfiles = profiles.filter(profile => {
      // Must work at the searched company
      if (companyFromQuery && !isCurrentEmployee(profile, companyFromQuery)) {
        console.log(`[DEBUG] Filtered out ${profile.name}: Company mismatch (has: "${profile.company}", need: "${companyFromQuery}")`);
        return false;
      }
      
      // Must have matching job title if specified in search
      // Check against main title and all GPT-generated variations
      if (jobTitleFromQuery && !hasMatchingJobTitle(profile, jobTitleFromQuery, titleVariations)) {
        console.log(`[DEBUG] Filtered out ${profile.name}: Title mismatch (has: "${profile.title}", need: "${jobTitleFromQuery}")`);
        return false;
      }
      
      console.log(`[DEBUG] ✓ Included ${profile.name}: ${profile.title} at ${profile.company}`);
      return true;
    });
    
    console.log(`[DEBUG] Final results: ${finalProfiles.length} profiles`);

    // Check HubSpot for existing contacts to prevent duplicates
    const profilesWithHubSpotStatus = await checkHubSpotStatus(finalProfiles);

    return NextResponse.json({ profiles: profilesWithHubSpotStatus });
  } catch (error: any) {
    console.error('Search error:', error);
    
    // Provide more helpful error messages
    let errorMessage = 'Failed to search profiles';
    if (error.message?.includes('fetch failed') || error.message?.includes('timeout')) {
      errorMessage = 'Search timed out. Exa API may be slow or unreachable. Please try again.';
    } else if (error.message?.includes('API key')) {
      errorMessage = 'Invalid Exa API key. Please check your configuration.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// Helper function to extract company name from search query
function extractCompanyFromQuery(query: string): string {
  // Look for patterns: "at Company" or "@ Company"
  const atMatch = query.match(/(?:at|@)\s+([A-Z][a-zA-Z0-9\s&.]+?)(?:\s|$)/i);
  if (atMatch && atMatch[1]) {
    return atMatch[1].trim();
  }
  return '';
}

// Helper function to extract job title from search query
function extractJobTitleFromQuery(query: string): string {
  // Get everything before "at" or "@"
  // e.g., "data scientists at OpenAI" -> "data scientists"
  const beforeAt = query.split(/\s+(?:at|@)\s+/i)[0].trim();
  
  if (!beforeAt) return '';
  
  // Clean up common variations (plural, etc.)
  return beforeAt.toLowerCase();
}

// Map of common job title synonyms for flexible matching
const titleSynonyms: Record<string, string[]> = {
  'director': ['director', 'head', 'vp', 'vice president', 'lead', 'principal'],
  'engineer': ['engineer', 'developer', 'programmer', 'technologist', 'swe', 'mts', 'member of technical staff', 'ic', 'individual contributor', 'staff engineer', 'senior engineer'],
  'scientist': ['scientist', 'researcher', 'research engineer', 'research scientist', 'applied scientist'],
  'manager': ['manager', 'lead', 'supervisor', 'head', 'em', 'engineering manager', 'technical lead', 'tech lead', 'tl'],
  'founder': ['founder', 'co-founder', 'cofounder', 'ceo', 'chief executive'],
  'designer': ['designer', 'ux', 'ui', 'product designer', 'design lead', 'creative director'],
  'analyst': ['analyst', 'associate', 'specialist', 'consultant'],
  'product': ['product manager', 'pm', 'product lead', 'product owner', 'tpm', 'technical product manager'],
  'data': ['data scientist', 'data engineer', 'data analyst', 'ml engineer', 'machine learning engineer'],
};

// Helper function to use GPT to intelligently parse search query
async function parseQueryWithGPT(query: string): Promise<{
  company: string;
  jobTitle: string;
  titleVariations: string[];
}> {
  // Skip GPT if no API key configured
  if (!process.env.OPENAI_API_KEY) {
    console.log('[DEBUG] No OpenAI API key, skipping GPT parsing');
    return { company: '', jobTitle: '', titleVariations: [] };
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that parses job search queries. Extract the company name, job title, and provide alternative job titles that might be used at that company. Respond in JSON format: {\"company\": \"CompanyName\", \"jobTitle\": \"MainTitle\", \"titleVariations\": [\"alt1\", \"alt2\", \"alt3\"]}"
        },
        {
          role: "user",
          content: `Parse this job search query and provide alternatives: "${query}"\n\nFor example, if searching for "director at OpenAI", the title variations might include: "Head of", "VP", "Vice President", "Lead", etc. Consider what title variations that specific company might use.`
        }
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const responseText = completion.choices[0].message.content || '{}';
    const parsed = JSON.parse(responseText);
    
    console.log('[DEBUG] GPT response:', parsed);
    
    return {
      company: parsed.company || '',
      jobTitle: parsed.jobTitle || '',
      titleVariations: parsed.titleVariations || [],
    };
  } catch (error: any) {
    console.error('[DEBUG] GPT parsing error:', error.message);
    return { company: '', jobTitle: '', titleVariations: [] };
  }
}

// Helper function to check if profile's job title matches searched title
function hasMatchingJobTitle(profile: any, searchedTitle: string, titleVariations: string[] = []): boolean {
  const profileTitle = (profile.title || '').toLowerCase();
  
  // Exclude profiles without a title
  if (!profileTitle || profileTitle === 'not specified') {
    return false;
  }
  
  const searchedLower = searchedTitle.toLowerCase();
  
  // Normalize hyphens and special characters for better matching
  const normalizeTitle = (title: string) => title.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedProfile = normalizeTitle(profileTitle);
  const normalizedSearch = normalizeTitle(searchedLower);
  
  // Direct substring match (normalized)
  if (normalizedProfile.includes(normalizedSearch) || normalizedSearch.includes(normalizedProfile)) {
    return true;
  }
  
  // Special case: "co-founder" and "founder" should match each other
  if ((normalizedSearch.includes('founder') || normalizedProfile.includes('founder'))) {
    if (normalizedSearch.includes('co founder') || normalizedSearch.includes('cofounder')) {
      // Searching for co-founder - accept "founder", "co-founder", "cofounder"
      return normalizedProfile.includes('founder');
    }
    if (normalizedProfile.includes('co founder') || normalizedProfile.includes('cofounder')) {
      // Profile is co-founder - matches "founder" search
      return normalizedSearch.includes('founder');
    }
  }
  
  // Check GPT-generated title variations first (most accurate)
  if (titleVariations.length > 0) {
    for (const variation of titleVariations) {
      const normalizedVariation = normalizeTitle(variation.toLowerCase());
      if (normalizedProfile.includes(normalizedVariation) || normalizedVariation.includes(normalizedProfile)) {
        return true;
      }
    }
  }
  
  // Check for synonym matches (e.g., "director" should match "head", "vp", etc.)
  // Also check if any search word matches any base title
  const searchTerms = normalizedSearch.split(/\s+/);
  
  for (const [baseTitle, synonyms] of Object.entries(titleSynonyms)) {
    // Check if search contains the base title or any word from it
    const baseTitleWords = baseTitle.split(/\s+/);
    const hasBaseTitleMatch = baseTitleWords.some(word => 
      searchTerms.some(sw => sw.includes(word) || word.includes(sw))
    );
    
    if (hasBaseTitleMatch || normalizedSearch.includes(baseTitle)) {
      // Check if profile contains any synonym
      if (synonyms.some(syn => normalizedProfile.includes(syn))) {
        return true;
      }
    }
  }
  
  // Handle common variations - more lenient matching
  // "engineer" matches "software engineer", "senior engineer", etc.
  const searchWords = searchTerms;
  const profileWords = normalizedProfile.split(/\s+/);
  
  // Check if key words from search appear in profile title
  const keyMatches = searchWords.filter(word => {
    // Skip common words
    if (['a', 'the', 'and', 'or', 'at', 'in', 'of', 'senior', 'junior', 'staff'].includes(word)) return false;
    // Check if this word appears in profile title
    return profileWords.some((pWord: string) => pWord.includes(word) || word.includes(pWord));
  });
  
  // More lenient: If ANY key word matches, consider it a match (was 50%)
  return keyMatches.length > 0;
}

// Helper function to add delay between requests
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to check if profiles already exist in HubSpot
async function checkHubSpotStatus(profiles: any[]): Promise<any[]> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.log('[DEBUG] No HubSpot token, skipping duplicate check');
    return profiles;
  }

  const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });
  const profilesWithStatus: any[] = [];

  // Check profiles sequentially with delay to avoid rate limits
  for (const profile of profiles) {
    try {
      // Search HubSpot for contact by LinkedIn URL
      const searchResponse = await hubspotClient.crm.contacts.searchApi.doSearch({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'hs_linkedin_url',
                operator: 'EQ' as any,
                value: profile.linkedinUrl,
              },
            ],
          },
        ],
        properties: ['firstname', 'lastname'],
        limit: 1,
      });

      if (searchResponse.results.length > 0) {
        // Profile exists in HubSpot
        console.log(`[DEBUG] ✓ Found ${profile.name} in HubSpot`);
        profilesWithStatus.push({
          ...profile,
          inHubSpot: true,
          hubSpotContactId: searchResponse.results[0].id,
        });
      } else {
        // New profile
        profilesWithStatus.push({
          ...profile,
          inHubSpot: false,
        });
      }
      
      // Add 200ms delay between requests to avoid rate limit
      await delay(200);
      
    } catch (error: any) {
      console.error(`Error checking HubSpot for ${profile.name}:`, error.message);
      // On error, assume not in HubSpot
      profilesWithStatus.push({
        ...profile,
        inHubSpot: false,
      });
    }
  }

  const inHubSpotCount = profilesWithStatus.filter(p => p.inHubSpot).length;
  console.log(`[DEBUG] HubSpot check complete: ${inHubSpotCount}/${profilesWithStatus.length} already in CRM`);

  return profilesWithStatus;
}

// Helper function to check if profile indicates employment at the searched company
function isCurrentEmployee(profile: any, searchCompany: string): boolean {
  const companyLower = searchCompany.toLowerCase();
  const profileCompany = (profile.company || '').toLowerCase();
  
  // STRICT: Company field must match the searched company
  // This ensures the person actually works/worked at the searched company
  if (!profileCompany || profileCompany === 'not specified') {
    return false;
  }
  
  // Check if profile company matches search company (with some fuzzy matching)
  // e.g., "OpenAI" matches "OpenAI" or "openai"
  if (profileCompany.includes(companyLower) || companyLower.includes(profileCompany)) {
    return true;
  }
  
  // Exact match (case insensitive)
  if (profileCompany === companyLower) {
    return true;
  }
  
  // No match - exclude this profile
  return false;
}

// Helper function to clean extracted text from markdown and formatting
function cleanExtractedText(text: string): string {
  return text
    .replace(/^[#•·\-\s]+/, '')              // Remove leading symbols
    .replace(/\[([^\]]+)\]/g, '$1')          // Remove markdown links [text]
    .replace(/<[^>]+>/g, '')                 // Remove HTML/markdown tags
    .replace(/\(Current\)/gi, '')            // Remove (Current)
    .replace(/\(Full[- ]time\)/gi, '')       // Remove (Full-time)
    .replace(/^(?:at|@)\s+/i, '')            // Remove leading "at" or "@"
    .replace(/\s+(?:at|@)\s*$/i, '')         // Remove trailing "at" or "@"
    .replace(/\s+/g, ' ')                    // Normalize whitespace
    .trim();
}

// Helper function to extract a meaningful bio
function extractBio(text: string, highlights: string, pageTitle: string): string {
  const fullText = `${highlights} ${text}`;
  
  // Filter out common LinkedIn login/UI text
  const junkPatterns = [
    /sign in to view/i,
    /join now/i,
    /email or phone/i,
    /forgot password/i,
    /user agreement/i,
    /privacy policy/i,
    /cookie policy/i,
    /new to linkedin/i,
    /by clicking continue/i,
    /view.*profile/i,
    /connect with/i,
  ];
  
  // Split into sentences and filter
  const sentences = fullText.split(/[.!?]+/).map(s => s.trim()).filter(s => {
    if (s.length < 20 || s.length > 300) return false;
    return !junkPatterns.some(pattern => pattern.test(s));
  });
  
  // If we found good sentences, return the first one
  if (sentences.length > 0) {
    return cleanExtractedText(sentences[0]);
  }
  
  // Fallback: Try to extract from page title (after the name)
  // Format: "Name - Title at Company | LinkedIn"
  const titleMatch = pageTitle.match(/\-\s*(.+?)\s*\|/);
  if (titleMatch && titleMatch[1]) {
    return cleanExtractedText(titleMatch[1]);
  }
  
  // Last resort: return empty or a placeholder
  return 'LinkedIn profile (bio not available)';
}

// Main extraction logic
function extractProfileData(result: any, searchCompany: string) {
      // LinkedIn title format examples:
      // "Chris Beaumont - Data Science @ OpenAI | LinkedIn"
      // "Daniel McAuley - Data at OpenAI | LinkedIn"
      // "Name - Title at Company | LinkedIn"
      
      const title = result.title || '';
      const text = result.text || '';
      const highlights = result.highlights?.join(' ') || '';
      
      // Extract a clean bio/summary
      const summary = extractBio(text, highlights, title);
      
      // Remove "| LinkedIn" and similar suffixes
      const cleanTitle = title.replace(/\s*[\|•]\s*(LinkedIn|Professional Profile).*$/i, '').trim();
      
      let name = 'Unknown';
      let jobTitle = 'Not specified';
      let company = 'Not specified';
      
      // Split on the dash to separate name from rest
      const dashIndex = cleanTitle.indexOf(' - ');
      
      if (dashIndex !== -1) {
        // Extract name (everything before the dash)
        name = cleanTitle.substring(0, dashIndex).trim();
        
        // Everything after the dash contains job title and company
        const afterDash = cleanTitle.substring(dashIndex + 3).trim();
        
        // Look for separator: " at ", " @ ", " | "
        let separator = null;
        let sepIndex = -1;
        
        // Check for different separator patterns
        const separators = [' @ ', ' at ', ' | '];
        for (const sep of separators) {
          const idx = afterDash.toLowerCase().indexOf(sep.toLowerCase());
          if (idx !== -1) {
            separator = sep;
            sepIndex = idx;
            break;
          }
        }
        
        if (sepIndex !== -1 && separator) {
          // Found separator - split job title and company
          jobTitle = afterDash.substring(0, sepIndex).trim();
          company = afterDash.substring(sepIndex + separator.length).trim();
        } else {
          // No separator found - need to determine if it's a job title or company name
          // Heuristic: If it's short (1-3 words) and doesn't contain typical job words,
          // it's likely just a company name
          const jobWords = ['engineer', 'manager', 'director', 'developer', 'designer', 
                           'scientist', 'analyst', 'lead', 'specialist', 'consultant',
                           'architect', 'researcher', 'coordinator', 'associate', 'intern'];
          
          const wordCount = afterDash.split(/\s+/).length;
          const lowerAfterDash = afterDash.toLowerCase();
          const hasJobWord = jobWords.some(word => lowerAfterDash.includes(word));
          
          if (wordCount <= 3 && !hasJobWord) {
            // Likely a company name
            company = afterDash;
            jobTitle = 'Not specified';
          } else {
            // Likely a job title
            jobTitle = afterDash;
          }
        }
      } else {
        // No dash found - whole thing might just be the name
        name = cleanTitle || 'Unknown';
      }
      
      // Clean up extracted data - remove extra whitespace
      name = name.replace(/\s+/g, ' ').trim();
      jobTitle = jobTitle.replace(/\s+/g, ' ').trim();
      company = company.replace(/\s+/g, ' ').trim();
      
      // Remove any trailing/leading special characters
      company = company.replace(/^[@|•\-\s]+|[@|•\-\s]+$/g, '').trim();
      jobTitle = jobTitle.replace(/^[@|•\-\s]+|[@|•\-\s]+$/g, '').trim();
      
      // IMPROVED: Try to extract better job title from text/bio/experience section
      // Only if we have reasonable text content to work with
      if ((text && text.length > 50) || (highlights && highlights.length > 50)) {
        const fullText = `${text} ${highlights}`;
        
        // Pattern 1: Look for "Experience" section with job titles
        // This is the most reliable pattern for LinkedIn
        const experiencePatterns = [
          /Experience[:\s\n]+([^\n•·\d]{5,80})[\n•·]/i,  // General experience pattern
          /Current[:\s]+([^\n•·\d]{5,80})[\n•·]/i,       // Current position
        ];
        
        for (const pattern of experiencePatterns) {
          const match = fullText.match(pattern);
          if (match && match[1]) {
            const extractedTitle = cleanExtractedText(match[1].trim());
            // Validate it looks like a job title
            const isDuration = /\d+\s*(year|yr|month|mo|week|day)s?/i.test(extractedTitle);
            const isDate = /^\d{4}/.test(extractedTitle) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(extractedTitle);
            const isValidLength = extractedTitle.length >= 5 && extractedTitle.length <= 80;
            const hasOnlyName = /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(extractedTitle); // "First Last"
            
            if (isValidLength && !isDuration && !isDate && !hasOnlyName) {
              jobTitle = extractedTitle;
              break;
            }
          }
        }
        
        // Pattern 2: Look for job title abbreviations in bio (only if no title found yet)
        if (jobTitle === 'Not specified') {
          const abbrevMatch = fullText.match(/\b([A-Z]{2,})\b\s*[@|at]\s*([A-Z][a-zA-Z0-9\s&]+)/i);
          if (abbrevMatch) {
            jobTitle = abbrevMatch[1];
            if (abbrevMatch[2] && company === 'Not specified') {
              company = abbrevMatch[2].trim().split(/[\n•·]/)[0].trim();
            }
          }
        }
      }
      
      // IMPROVED: If we have a search company, try to find their role at that specific company
      if (searchCompany && (text || highlights)) {
        const fullText = `${text} ${highlights}`;
        
        // Look for experience entries that mention the search company
        // Pattern: "Job Title\nCompany Name" or "Job Title at Company Name"
        const companyPattern = new RegExp(
          `([^\\n•·]{5,80})[\\s\\n]+(?:at\\s+)?${searchCompany.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'i'
        );
        
        const companyMatch = fullText.match(companyPattern);
        if (companyMatch && companyMatch[1]) {
          const extractedTitle = cleanExtractedText(companyMatch[1].trim());
          
          // Validate it looks like a job title
          const isDuration = /\d+\s*(year|yr|month|mo|week|day)s?/i.test(extractedTitle);
          const isDate = /^\d{4}/.test(extractedTitle) || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(extractedTitle);
          const isValidLength = extractedTitle.length >= 5 && extractedTitle.length <= 80;
          const hasOnlyName = /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(extractedTitle);
          
          if (isValidLength && !isDuration && !isDate && !hasOnlyName) {
            jobTitle = extractedTitle;
            company = searchCompany; // Use the search company since we matched it
          }
        }
      }
      
      // Final cleanup - remove markdown/formatting from all fields
      name = cleanExtractedText(name);
      jobTitle = cleanExtractedText(jobTitle);
      company = cleanExtractedText(company);
      
      return {
        id: result.id,
        name,
        title: jobTitle,
        company,
        linkedinUrl: result.url,
        summary,
      };
}
