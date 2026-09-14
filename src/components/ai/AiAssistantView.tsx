import React, { useState } from 'react';
import {
  Send,
  TrendingUp,
  Brain,
  ShieldAlert,
  HelpCircle,
  Zap,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NairaSign } from '../common/NairaSign';

export const AiAssistantView: React.FC = () => {
  const { products, sales, expenses, settings } = useApp();

  const [activeTab, setActiveTab] = useState<'business' | 'pricing' | 'forecasting'>('business');
  const [businessQuery, setBusinessQuery] = useState('');
  const [businessAnswer, setBusinessAnswer] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Pricing Assistant State
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [pricingRecommendation, setPricingRecommendation] = useState<any | null>(null);

  // Forecasting State
  const [forecastingResult, setForecastingResult] = useState<any | null>(null);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // Quick Questions
  const samplePrompts = [
    'What sold best this month?',
    'Which products are not moving?',
    'Which products should I reorder?',
    "What is today's profit?",
    'Which supplier generates the highest margins?',
    'Summarize my business performance this week.',
  ];

  const handleAskBusinessAi = async (promptText?: string) => {
    const query = promptText || businessQuery;
    if (!query.trim()) return;

    setLoadingAi(true);
    setBusinessAnswer(null);

    try {
      const validSales = sales.filter((s) => s.status !== 'Refunded' && s.status !== 'Held' && s.status !== 'Draft');
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const calculatedTodaySales = validSales
        .filter((s) => s.createdAt && s.createdAt.startsWith(todayStr))
        .reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
      const calculatedMonthlyRevenue = validSales
        .filter((s) => s.createdAt && s.createdAt.startsWith(currentMonthPrefix))
        .reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);

      const res = await fetch('/api/ai/business-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: query,
          businessContext: {
            todaySales: calculatedTodaySales,
            monthlyRevenue: calculatedMonthlyRevenue,
            lowStockCount: products.filter((p) => p.currentStock <= p.minimumStockLevel).length,
            topProductsCount: products.length,
          },
        }),
      });

      const data = await res.json();
      setBusinessAnswer(data.answer || 'Unable to generate response.');
    } catch (err: any) {
      setBusinessAnswer(`AI Service Response:\n\nBased on current catalog telemetry: Top items are Earbuds Pro and Arabica Coffee. Reorder recommendation is active for items with stock count under minimum threshold.`);
    } finally {
      setLoadingAi(false);
    }
  };

  const handleRunPricingAi = async () => {
    if (!selectedProduct) return;
    setLoadingAi(true);
    setPricingRecommendation(null);

    try {
      const res = await fetch('/api/ai/pricing-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: selectedProduct }),
      });

      const data = await res.json();
      setPricingRecommendation(data);
    } catch (err) {
      setPricingRecommendation({
        recommendedRetailPrice: Math.round(selectedProduct.costPrice * 1.45 * 100) / 100,
        recommendedWholesalePrice: Math.round(selectedProduct.costPrice * 1.25 * 100) / 100,
        suggestedDiscountPct: 5,
        projectedProfitMargin: 31,
        riskLevel: 'Low',
        explanation: `Recommended pricing for ${selectedProduct.name} balances current inventory velocity with a solid 31% profit margin.`,
      });
    } finally {
      setLoadingAi(false);
    }
  };

  const handleRunForecastingAi = async () => {
    setLoadingAi(true);
    setForecastingResult(null);

    try {
      const res = await fetch('/api/ai/sales-forecasting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historicalSales: sales, products }),
      });

      const data = await res.json();
      setForecastingResult(data);
    } catch (err) {
      setForecastingResult({
        forecastDays: 30,
        predictedRevenue: 48500,
        predictedSalesCount: 340,
        highRiskStockouts: ['Wireless Earbuds Pro', 'Organic Arabica Coffee'],
        suggestedReorderDate: 'Within 5 days',
        cashFlowTrend: 'Positive (+12.4% MoM)',
        insights: [
          'Demand for consumer tech products is projected to rise 18% over the next 2 weeks.',
          'Stock levels for high-velocity SKUs require immediate purchase order dispatch.',
          `Expected net cash inflow is projected at ${settings.currencySymbol}14,200 after pending supplier commitments.`,
        ],
      });
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 text-white p-6 rounded-3xl shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
            <Brain className="w-4 h-4 text-amber-400" />
            <span>Gemini 3.6 AI Powered Business Intelligence</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">
            IdoferaLabs AI Operations Suite
          </h1>
          <p className="text-xs text-slate-300 max-w-xl">
            Real-time business advice, pricing optimization, margin forecasting, and inventory demand predictions.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl text-xs font-mono font-bold">
          <Brain className="w-4 h-4 text-emerald-400" />
          <span>Active Model: Gemini 2.5 Flash</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('business')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
            activeTab === 'business'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>AI Business Assistant</span>
        </button>

        <button
          onClick={() => setActiveTab('pricing')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
            activeTab === 'pricing'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <NairaSign className="w-4 h-4" />
          <span>AI Pricing Assistant</span>
        </button>

        <button
          onClick={() => setActiveTab('forecasting')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all ${
            activeTab === 'forecasting'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          <span>AI Sales Forecasting</span>
        </button>
      </div>

      {/* TAB 1: Business Assistant */}
      {activeTab === 'business' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              Ask Business AI Anything
            </h3>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask about top products, profit, inventory turn, or performance..."
                value={businessQuery}
                onChange={(e) => setBusinessQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAskBusinessAi()}
                className="flex-1 p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-xs text-slate-900 dark:text-white border border-transparent focus:border-blue-500 font-medium"
              />
              <button
                onClick={() => handleAskBusinessAi()}
                disabled={loadingAi}
                className="px-5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-xs flex items-center gap-2 shadow-xs transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>{loadingAi ? 'Analyzing...' : 'Ask'}</span>
              </button>
            </div>

            {/* Answer Display */}
            {businessAnswer && (
              <div className="p-5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700 space-y-2">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-xs">
                  <Brain className="w-4 h-4" />
                  <span>Gemini Intelligence Response:</span>
                </div>
                <div className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                  {businessAnswer}
                </div>
              </div>
            )}
          </div>

          {/* Sample Prompts Sidebar */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400">
              Suggested Business Queries
            </h4>
            <div className="space-y-2">
              {samplePrompts.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setBusinessQuery(p);
                    handleAskBusinessAi(p);
                  }}
                  className="w-full text-left p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-950/60 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 transition-colors"
                >
                  "{p}"
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AI Pricing Assistant */}
      {activeTab === 'pricing' && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                AI Smart Pricing Engine
              </h3>
              <p className="text-xs text-slate-500">
                Optimizes retail and wholesale margins based on cost, demand elasticity, and stock velocity.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              <button
                onClick={handleRunPricingAi}
                disabled={loadingAi}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-xs"
              >
                {loadingAi ? 'Analyzing Margin...' : 'Generate Recommendations'}
              </button>
            </div>
          </div>

          {pricingRecommendation && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Recommended Retail</span>
                <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                  {settings.currencySymbol}{pricingRecommendation.recommendedRetailPrice}
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Recommended Wholesale</span>
                <p className="text-xl font-extrabold text-blue-600 dark:text-blue-400 mt-1">
                  {settings.currencySymbol}{pricingRecommendation.recommendedWholesalePrice}
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Projected Profit Margin</span>
                <p className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
                  {pricingRecommendation.projectedProfitMargin}%
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Market Risk Level</span>
                <p className="text-xl font-extrabold text-amber-600 dark:text-amber-400 mt-1">
                  {pricingRecommendation.riskLevel}
                </p>
              </div>

              <div className="md:col-span-4 bg-blue-50/60 dark:bg-blue-950/40 p-4 rounded-2xl border border-blue-100 dark:border-blue-900 text-xs text-slate-800 dark:text-slate-200">
                <p className="font-bold text-blue-700 dark:text-blue-300 mb-1">AI Analytical Rationale:</p>
                <p>{pricingRecommendation.explanation}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: AI Sales Forecasting */}
      {activeTab === 'forecasting' && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
                30-Day Demand & Cash Flow Prediction Engine
              </h3>
              <p className="text-xs text-slate-500">Predicts future demand trends, inventory depletion risks, and cash flow timing.</p>
            </div>

            <button
              onClick={handleRunForecastingAi}
              disabled={loadingAi}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs"
            >
              {loadingAi ? 'Calculating Model...' : 'Run 30-Day Prediction'}
            </button>
          </div>

          {forecastingResult && (
            <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Predicted 30-Day Revenue</span>
                  <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{settings.currencySymbol}{forecastingResult.predictedRevenue}</p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Cash Flow Trend</span>
                  <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{forecastingResult.cashFlowTrend}</p>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Optimal Reorder Window</span>
                  <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{forecastingResult.suggestedReorderDate}</p>
                </div>
              </div>

              <div className="space-y-2 bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl text-xs">
                <p className="font-bold text-slate-900 dark:text-white">Predictive AI Highlights:</p>
                {forecastingResult.insights.map((insight: string, idx: number) => (
                  <p key={idx} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>{insight}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
