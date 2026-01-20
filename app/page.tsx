'use client';

import { useState } from 'react';

interface Profile {
  id: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
  summary: string;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [hideContacted, setHideContacted] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');
    setProfiles([]);
    setSelectedProfiles(new Set());

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setProfiles(data.profiles);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedProfiles(new Set(profiles.map(p => p.id)));
    } else {
      setSelectedProfiles(new Set());
    }
  };

  const handleSelectProfile = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedProfiles);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedProfiles(newSelected);
  };

  const handleExport = async () => {
    if (selectedProfiles.size === 0) {
      alert('Please select at least one profile to export');
      return;
    }

    setExporting(true);

    try {
      const selectedProfileData = profiles.filter(p => selectedProfiles.has(p.id));

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: selectedProfileData }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Export failed');
      }

      // Download the CSV
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `profiles_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert(`✓ Successfully exported ${selectedProfiles.size} profiles and synced to HubSpot!`);
      
      // Clear selection after export
      setSelectedProfiles(new Set());
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 text-gray-900">People Search</h1>
        <p className="text-gray-700 mb-8">Search for profiles and export to HubSpot</p>

        {/* Search Bar */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex gap-4">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder='e.g., "rubric makers at Scale AI"'
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-500"
              disabled={loading}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Results */}
        {profiles.length > 0 && (() => {
          const filteredProfiles = hideContacted 
            ? profiles.filter(p => !p.inHubSpot)
            : profiles;
          
          const contactedCount = profiles.filter(p => p.inHubSpot).length;
          
          return (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {profiles.length} profiles found
                </h2>
                <span className="text-gray-700">
                  ({selectedProfiles.size} selected)
                </span>
                {contactedCount > 0 && (
                  <span className="text-orange-600 text-sm">
                    • {contactedCount} already in CRM
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {contactedCount > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideContacted}
                      onChange={(e) => setHideContacted(e.target.checked)}
                      className="w-4 h-4 cursor-pointer"
                    />
                    Hide contacted
                  </label>
                )}
                <button
                  onClick={handleExport}
                  disabled={selectedProfiles.size === 0 || exporting}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                >
                  {exporting ? 'Exporting...' : `Export ${selectedProfiles.size > 0 ? `(${selectedProfiles.size})` : ''}`}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left">
                      <input
                        type="checkbox"
                        checked={selectedProfiles.size === profiles.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Title</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Company</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Bio</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">LinkedIn URL</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredProfiles.map((profile) => (
                    <tr key={profile.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProfiles.has(profile.id)}
                          onChange={(e) => handleSelectProfile(profile.id, e.target.checked)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{profile.name}</span>
                          {profile.inHubSpot && (
                            <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-700 rounded">
                              In CRM
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-800">{profile.title}</td>
                      <td className="px-6 py-4 text-gray-800">{profile.company}</td>
                      <td className="px-6 py-4 text-gray-700 text-sm max-w-xs truncate">{profile.summary}</td>
                      <td className="px-6 py-4 text-blue-600 text-sm max-w-xs truncate">
                        {profile.linkedinUrl}
                      </td>
                      <td className="px-6 py-4">
                        <a
                          href={profile.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-sm"
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}

        {/* Empty State */}
        {!loading && profiles.length === 0 && !error && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg">Start by searching for profiles above</p>
            <p className="text-sm mt-2">Try: "ML engineers at OpenAI" or "designers at Figma"</p>
          </div>
        )}
        </div>
    </div>
  );
}
