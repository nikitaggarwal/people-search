import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@hubspot/api-client';
import Papa from 'papaparse';

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_ACCESS_TOKEN });

interface Profile {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
  summary: string;
}

export async function POST(request: NextRequest) {
  try {
    const { profiles } = await request.json();

    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      return NextResponse.json(
        { error: 'No profiles provided' },
        { status: 400 }
      );
    }

    // Sync to HubSpot
    const hubspotResults = await syncToHubSpot(profiles);

    // Generate CSV
    const csvData = profiles.map((profile: Profile) => ({
      Name: profile.name,
      Title: profile.title,
      Company: profile.company,
      Bio: profile.summary,
      'LinkedIn URL': profile.linkedinUrl,
    }));

    const csv = Papa.unparse(csvData);

    // Return CSV as downloadable file
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="profiles_${Date.now()}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to export profiles' },
      { status: 500 }
    );
  }
}

async function syncToHubSpot(profiles: Profile[]) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
  };

  for (const profile of profiles) {
    try {
      // Try to find existing contact by LinkedIn URL
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
        // Contact exists, update it
        const contactId = searchResponse.results[0].id;
        await hubspotClient.crm.contacts.basicApi.update(contactId, {
          properties: {
            firstname: profile.name.split(' ')[0] || profile.name,
            lastname: profile.name.split(' ').slice(1).join(' ') || '',
            jobtitle: profile.title,
            company: profile.company,
            hs_linkedin_url: profile.linkedinUrl,
          },
        });
        results.updated++;
      } else {
        // Create new contact
        await hubspotClient.crm.contacts.basicApi.create({
          properties: {
            firstname: profile.name.split(' ')[0] || profile.name,
            lastname: profile.name.split(' ').slice(1).join(' ') || '',
            jobtitle: profile.title,
            company: profile.company,
            hs_linkedin_url: profile.linkedinUrl,
          },
        });
        results.created++;
      }
    } catch (error: any) {
      console.error(`Failed to sync profile ${profile.name}:`, error.message);
      results.failed++;
    }
  }

  console.log('HubSpot sync results:', results);
  return results;
}
