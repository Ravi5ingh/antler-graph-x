/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Loader2, Fingerprint, History, ChevronRight, Globe, AlertCircle } from "lucide-react";
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
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden selection:bg-white/20">
      {/* Sidebar */}
      <aside className="w-80 border-r border-white/10 flex flex-col bg-[#0a0a0a]">
        <div className="p-6 border-b border-white/10 bg-[#0a0a0a]">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.1)]">
              <Fingerprint className="w-6 h-6 text-black" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg font-bold tracking-tight leading-none">Neuralend</h1>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-semibold mt-1">Research</span>
            </div>
          </div>
          
          <form onSubmit={createTopic} className="relative">
            <input
              type="text"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder="Initialize research..."
              className="w-full pl-4 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-xl focus:bg-white/10 focus:border-white/30 focus:outline-none transition-all text-sm placeholder:text-white/20"
            />
            <button 
              type="submit"
              disabled={isCreating || !newTopicName.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white disabled:opacity-50 transition-colors"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-5 h-5" />}
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="flex items-center gap-2 px-2 mb-4 text-[10px] font-bold text-white/30 uppercase tracking-[0.15em]">
            <History className="w-3 h-3" />
            Archive
          </div>
          {topics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => setSelectedTopic(topic)}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-xl transition-all text-left group border",
                selectedTopic?.id === topic.id 
                  ? "bg-white/10 border-white/20 shadow-lg" 
                  : "hover:bg-white/5 border-transparent text-white/60 hover:text-white"
              )}
            >
              <div className="flex flex-col overflow-hidden">
                <span className="font-medium text-sm truncate">{topic.name}</span>
                <span className="text-[10px] opacity-40 mt-1">
                  {new Date(topic.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center">
                {topic.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin text-white/50" />}
                {topic.status === 'error' && <AlertCircle className="w-3 h-3 text-red-500/80" />}
                {topic.status === 'completed' && <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />}
              </div>
            </button>
          ))}
          {topics.length === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-xs text-white/20">No active research nodes.</p>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-black">
        {selectedTopic ? (
          <>
            <header className="p-6 border-b border-white/10 flex items-center justify-between bg-black/50 backdrop-blur-md z-10">
              <div>
                <h2 className="text-xl font-bold tracking-tight flex items-center gap-3">
                  {selectedTopic.name}
                  {selectedTopic.status === 'processing' && (
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-white/10 text-white/60 px-2.5 py-1 rounded-full flex items-center gap-2 animate-pulse border border-white/5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Synthesizing
                    </span>
                  )}
                </h2>
                <p className="text-xs text-white/40 mt-1 uppercase tracking-wider">
                  Neural Knowledge Mapping System
                </p>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-white/30">
                  <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"></div> Entity</div>
                  <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div> Location</div>
                  <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"></div> Concept</div>
                </div>
              </div>
            </header>

            <div className="flex-1 relative overflow-hidden">
              {selectedTopic.status === 'completed' ? (
                isLoadingGraph ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black">
                    <Loader2 className="w-8 h-8 animate-spin text-white/20" />
                  </div>
                ) : (
                  <GraphVisualization data={graphData} />
                )
              ) : selectedTopic.status === 'processing' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-12 text-center">
                  <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mb-8 animate-pulse border border-white/10">
                    <Globe className="w-10 h-10 text-white/40" />
                  </div>
                  <h3 className="text-lg font-bold mb-3 tracking-tight">Accessing Global Intelligence</h3>
                  <p className="text-white/40 max-w-sm text-xs leading-relaxed uppercase tracking-widest">
                    Searching web nodes, scraping data clusters, and extracting neural relationships.
                  </p>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black p-12 text-center">
                  <AlertCircle className="w-10 h-10 text-red-500/50 mb-4" />
                  <h3 className="text-lg font-bold mb-2">Node Failure</h3>
                  <p className="text-white/40 text-xs uppercase tracking-widest">
                    Critical error during graph synthesis.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#050505]">
            <div className="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center mb-10 shadow-[0_0_50px_rgba(255,255,255,0.1)]">
              <Fingerprint className="w-12 h-12 text-black" />
            </div>
            <h2 className="text-4xl font-bold tracking-tighter mb-6">Neuralend Research</h2>
            <p className="text-white/40 max-w-md text-sm leading-relaxed uppercase tracking-[0.2em] font-light">
              Autonomous Intelligence for Knowledge Graph Synthesis
            </p>
            <div className="mt-16 grid grid-cols-3 gap-8 w-full max-w-2xl">
              {[
                { label: "Crawl", desc: "Web Node Discovery" },
                { label: "Extract", desc: "Neural Parsing" },
                { label: "Map", desc: "Relationship Synthesis" }
              ].map((step, i) => (
                <div key={i} className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-white/20 transition-colors group">
                  <div className="text-white/20 font-bold mb-2 text-xs tracking-widest group-hover:text-white/40 transition-colors">0{i+1}</div>
                  <div className="font-bold text-xs uppercase tracking-widest mb-2">{step.label}</div>
                  <div className="text-[10px] text-white/30 uppercase tracking-wider">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
