/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Loader2, Network, History, ChevronRight, Globe, AlertCircle } from "lucide-react";
import { GraphVisualization } from "./components/GraphVisualization";
import { GoogleGenAI } from "@google/genai";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Topic {
  id: number;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  created_at: string;
}

export default function App() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [graphData, setGraphData] = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [newTopicName, setNewTopicName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());

  const processTopic = useCallback(async (topic: Topic) => {
    if (processingIds.has(topic.id)) return;
    setProcessingIds(prev => new Set(prev).add(topic.id));

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // 1. Search for links
      const searchResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Find the top 5 most informative websites about: ${topic.name}`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const chunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const urls = chunks
        .filter(c => c.web?.uri)
        .map(c => c.web!.uri)
        .slice(0, 5);

      let finalGraphData = { nodes: [], links: [] };

      if (urls.length > 0) {
        // 2. Extract Graph using URL Context
        const graphResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Based on the provided URLs, extract a knowledge graph for the topic "${topic.name}". 
          Identify key entities (nodes) and their relationships (links).
          Return ONLY a JSON object with this structure:
          {
            "nodes": [{"id": "Entity Name", "type": "Person/Place/Concept/etc"}],
            "links": [{"source": "Entity A", "target": "Entity B", "label": "relationship description"}]
          }
          URLs to analyze: ${urls.join(", ")}`,
          config: {
            tools: [{ urlContext: {} }],
            responseMimeType: "application/json"
          },
        });
        finalGraphData = JSON.parse(graphResponse.text);
      }

      await fetch(`/api/topics/${topic.id}/graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: finalGraphData }),
      });

    } catch (error) {
      console.error(`Error processing topic ${topic.id}:`, error);
      await fetch(`/api/topics/${topic.id}/error`, { method: "POST" });
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(topic.id);
        return next;
      });
    }
  }, [processingIds]);

  useEffect(() => {
    fetchTopics();
    const interval = setInterval(fetchTopics, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Look for topics that need processing
    const toProcess = topics.filter(t => t.status === 'processing' && !processingIds.has(t.id));
    toProcess.forEach(processTopic);
  }, [topics, processingIds, processTopic]);

  useEffect(() => {
    if (selectedTopic && selectedTopic.status === 'completed') {
      fetchGraph(selectedTopic.id);
    } else {
      setGraphData({ nodes: [], links: [] });
    }
  }, [selectedTopic]);

  const fetchTopics = async () => {
    try {
      const res = await fetch("/api/topics");
      const data = await res.json();
      setTopics(data);
      
      // Update selected topic if it was processing and is now completed
      if (selectedTopic) {
        const updated = data.find((t: Topic) => t.id === selectedTopic.id);
        if (updated && updated.status !== selectedTopic.status) {
          setSelectedTopic(updated);
        }
      }
    } catch (err) {
      console.error("Failed to fetch topics", err);
    }
  };

  const fetchGraph = async (id: number) => {
    setIsLoadingGraph(true);
    try {
      const res = await fetch(`/api/topics/${id}/graph`);
      const data = await res.json();
      setGraphData(data);
    } catch (err) {
      console.error("Failed to fetch graph", err);
    } finally {
      setIsLoadingGraph(false);
    }
  };

  const createTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTopicName.trim() || isCreating) return;

    setIsCreating(true);
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTopicName }),
      });
      const data = await res.json();
      setTopics([data, ...topics]);
      setSelectedTopic(data);
      setNewTopicName("");
    } catch (err) {
      console.error("Failed to create topic", err);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex h-screen bg-white text-slate-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r border-slate-200 flex flex-col bg-slate-50/50">
        <div className="p-6 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Network className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">GraphMind</h1>
          </div>
          
          <form onSubmit={createTopic} className="relative">
            <input
              type="text"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="New topic..."
              className="w-full pl-4 pr-10 py-2 bg-slate-100 border-transparent rounded-lg focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all text-sm"
            />
            <button 
              type="submit"
              disabled={isCreating || !newTopicName.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 disabled:opacity-50"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-5 h-5" />}
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center gap-2 px-2 mb-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <History className="w-3 h-3" />
            Recent Topics
          </div>
          {topics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => setSelectedTopic(topic)}
              className={cn(
                "w-full flex items-center justify-between p-3 rounded-xl transition-all text-left group",
                selectedTopic?.id === topic.id 
                  ? "bg-white shadow-sm border border-slate-200 ring-1 ring-slate-200" 
                  : "hover:bg-slate-100 text-slate-600"
              )}
            >
              <div className="flex flex-col overflow-hidden">
                <span className="font-medium text-sm truncate">{topic.name}</span>
                <span className="text-[10px] opacity-60">
                  {new Date(topic.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center">
                {topic.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />}
                {topic.status === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
                {topic.status === 'completed' && <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />}
              </div>
            </button>
          ))}
          {topics.length === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-sm text-slate-400">No topics yet. Create one to start exploring.</p>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {selectedTopic ? (
          <>
            <header className="p-6 border-b border-slate-200 flex items-center justify-between bg-white z-10">
              <div>
                <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                  {selectedTopic.name}
                  {selectedTopic.status === 'processing' && (
                    <span className="text-xs font-normal bg-indigo-50 text-indigo-600 px-2 py-1 rounded-full flex items-center gap-1.5 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Building Graph...
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Knowledge graph synthesized from top search results.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div> Person
                  <div className="w-2 h-2 rounded-full bg-emerald-500 ml-2"></div> Place
                  <div className="w-2 h-2 rounded-full bg-amber-500 ml-2"></div> Org
                </div>
              </div>
            </header>

            <div className="flex-1 relative overflow-hidden">
              {selectedTopic.status === 'completed' ? (
                isLoadingGraph ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-50/50">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                  </div>
                ) : (
                  <GraphVisualization data={graphData} />
                )
              ) : selectedTopic.status === 'processing' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/50 p-12 text-center">
                  <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
                    <Globe className="w-12 h-12 text-indigo-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Analyzing the Web</h3>
                  <p className="text-slate-500 max-w-md">
                    Our background service is currently searching the internet, scraping content, and extracting entities to build your knowledge graph. This usually takes 15-30 seconds.
                  </p>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/50 p-12 text-center">
                  <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                  <h3 className="text-xl font-bold mb-2">Processing Error</h3>
                  <p className="text-slate-500">
                    Something went wrong while building the graph for this topic. Please try creating it again.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50/30">
            <div className="w-20 h-20 bg-white shadow-xl rounded-3xl flex items-center justify-center mb-8 rotate-3">
              <Network className="w-10 h-10 text-indigo-600" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-4">Welcome to GraphMind</h2>
            <p className="text-slate-500 max-w-lg text-lg leading-relaxed">
              Enter any topic in the sidebar to start a background research task. 
              We'll crawl the web and build an interactive knowledge graph for you.
            </p>
            <div className="mt-12 grid grid-cols-3 gap-6 w-full max-w-2xl">
              {[
                { label: "Search", desc: "Real-time web crawling" },
                { label: "Scrape", desc: "Content extraction" },
                { label: "Graph", desc: "Entity mapping" }
              ].map((step, i) => (
                <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="text-indigo-600 font-bold mb-1">0{i+1}</div>
                  <div className="font-bold text-sm mb-1">{step.label}</div>
                  <div className="text-xs text-slate-400">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
