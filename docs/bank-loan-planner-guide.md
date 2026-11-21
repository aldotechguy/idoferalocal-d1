# Bank Loan Investment Planner — User Guide

## What Is This Feature?

Think of this as a **financial flight simulator** for borrowing money from a bank and investing it in stocks to grow your business.

### The Core Idea

1. **You borrow money** from a bank (a "loan")
2. **You invest that money** in stocks (shares of companies)
3. **The stocks generate returns** (dividends + price appreciation)
4. **You use those returns** to pay back the loan
5. **Ideally, you keep the profit** after the loan is paid off

This feature lets you **plan, simulate, and track** this entire process before committing real money.

---

## Key Concepts (Plain English)

### 1. Bank Loan = "Tranche"
A **tranche** is just a slice of a loan. You might have:
- **Tranche A**: ₦5M term loan at 18% fixed, paid monthly over 12 months
- **Tranche B**: ₦3M revolving credit at SOFR + 2.5%, interest-only for 6 months

Each tranche has its own terms. The system blends them into one picture.

### 2. Stock Portfolio = Your Investments
Instead of buying inventory (like the existing Capital Investment Planner), you're buying **shares of companies**. The system maps your existing Product catalog to stock-like metrics:
- **Cost Price** → Purchase price per share
- **Retail Price** → Current market price
- **Margin %** → Expected total return (dividend yield + price appreciation)
- **Sales Velocity** → Liquidity/volatility proxy (how actively traded)

### 3. Debt Service Coverage Ratio (DSCR) — The Most Important Number
```
DSCR = (Stock Portfolio Cash Inflow) ÷ (Loan Payment Due)
```

- **DSCR ≥ 1.5** → Safe (you earn 50% more than you owe)
- **DSCR 1.25–1.5** → Adequate
- **DSCR 1.0–1.25** → Tight
- **DSCR < 1.0** → Danger (you can't cover the payment)

**Covenants** are promises to the bank: "I'll keep my DSCR above 1.25." If you breach, the bank can call the loan.

### 4. Loan-to-Value (LTV)
```
LTV = (Outstanding Loan Balance) ÷ (Current Portfolio Value)
```

- **LTV ≤ 50%** → Conservative
- **LTV 50–70%** → Moderate
- **LTV 70–90%** → Aggressive
- **LTV > 90%** → Breach territory

### 5. Stress Tests
"What if things go wrong?"
- **Rate Shock**: Interest rates jump +2%
- **Market Drop**: Portfolio falls 30%
- **Combined**: Both at once

---

## How to Use the Feature

### Step 1: Open the Planner
1. Go to **Finance & Treasury** hub
2. Click the **"Bank Loan Planner"** tab (blue landmark icon)

You'll see two main tabs:
- **Loan Simulator & Planner** — Design and test scenarios
- **Live Campaign Tracker** — Monitor active campaigns

---

### Step 2: Configure Loan Tranches (Simulator Tab)

#### Add a Tranche
Click **"Add Tranche"**. Each tranche has:

| Field | What It Means | Example |
|-------|--------------|---------|
| **Name** | Label for you | "Tranche A - Term Loan" |
| **Type** | Loan structure | Term Loan / Revolving / Bridge |
| **Principal** | Amount borrowed | ₦5,000,000 |
| **Interest Rate** | Annual % | 18% |
| **Rate Type** | Fixed or floating | Fixed |
| **Reference Rate** | If floating, what benchmark | SOFR, Prime |
| **Spread (bps)** | Extra % over reference | 250 bps = 2.5% |
| **Tenure (Months)** | How long to repay | 12 |
| **Repayment** | How principal is paid | Bullet / Amortized / IO then Amortized / Lump Sum |
| **Frequency** | Payment cadence | Monthly / Quarterly / Semi-Annual |
| **Interest-Only Months** | Grace period before principal | 0–6 |
| **Origination Fee (bps)** | Upfront fee | 100 bps = 1% |
| **Commitment Fee (bps/yr)** | Fee on undrawn amount (revolving) | 25 bps |
| **Min DSCR Covenant** | Bank's minimum DSCR | 1.25 |
| **Max LTV Covenant** | Bank's maximum LTV | 0.80 (80%) |

#### Repayment Structures Explained
- **Bullet**: Pay interest monthly, ALL principal at the end
- **Amortized**: Equal principal each period + interest on remaining balance
- **Interest-Only Then Amortized**: Pay only interest for X months, then amortize
- **Lump Sum**: Nothing until maturity, then everything at once

---

### Step 3: Choose Stock Allocation Strategy

The system picks stocks from your Product catalog. Choose a strategy:

| Strategy | Best For | How It Works |
|----------|----------|--------------|
| **Dividend Focus** | Stable cash flow to cover loan | Picks high dividend yield stocks |
| **Growth Focus** | Maximum total return | Picks high appreciation potential |
| **Balanced** | Best risk-adjusted return | Optimizes Sharpe-like ratio |
| **Low Volatility** | Minimize drawdowns | Prefers stable, liquid stocks |
| **High Conviction** | Concentrated bets | Top 3–5 best risk/reward |

**Lookback Days**: How much sales history to use for velocity (14, 30, 60, 90, 180, All Time)

---

### Step 4: Fine-Tune Allocations (Optional)

The system auto-allocates. You can manually adjust:
- **+/- buttons** on each stock row to change share count
- **Add Stock** button to include more from catalog
- **Swap Stock** button to replace one with another
- **Reset to AI Allocation** to go back to auto

Unallocated capital shows as a warning — deploy it or accept lower returns.

---

### Step 5: Review Risk Metrics Dashboard

Key gauges (right panel):
- **Avg DSCR** — Average coverage across all periods
- **Min DSCR** — Worst-case coverage (critical!)
- **Initial LTV** — Starting leverage
- **Interest Coverage** — Dividends ÷ Interest

**Stress Test Results** (expand "Show Details"):
- Rate +200bps → DSCR & Net Cash Flow
- Market -30% → LTV & Portfolio Value
- Combined → Both metrics

**Sector Concentration** — Shows if you're overexposed to one sector.

---

### Step 6: View Cash Flow Projection Chart

The area chart shows period-by-period:
- **Red area** = Loan payments (principal + interest + fees)
- **Green area** = Portfolio inflows (dividends + appreciation realization)
- **Blue line** = Net cash flow (inflow - payment)
- **Covenant breach markers** = Red flags on periods

---

### Step 7: View Amortization Schedule

Bottom table shows every period:
- Principal due, Interest due, Fees, Total payment
- Outstanding balance
- Portfolio inflow, DSCR, Net cash flow
- Covenant status (OK / Breach)

---

### Step 8: Compare Strategies

Click **"Compare All Models"** to see all 5 strategies side-by-side:
- Total portfolio return
- Net benefit (return - loan cost)
- Average DSCR, Risk rating
- Click "Use This Strategy" to switch

---

### Step 8: Save Scenario

Click **"Save Scenario"**, give it a name (e.g., "₦10M Expansion 2026").
Saved scenarios appear in the **"Saved (N)"** dropdown with:
- Load button (restores all settings)
- Play button (starts live campaign directly)
- Delete button

---

### Step 9: Start Live Campaign

Click **"Start Campaign"** (green play button):
1. Name the campaign
2. Enter **Borrower** (your company) and **Lender** (bank name)
3. Set **Start Date**
4. Click **"Launch Campaign"**

This:
- Locks in current stock prices as cost basis
- Creates milestone schedule with due dates
- Switches to **Live Tracker** tab

---

### Step 10: Monitor in Live Tracker

#### Campaign Card Shows:
- **Portfolio Value** (current)
- **Next Payment Due** (amount + date)
- **Current DSCR** (real-time)
- **Covenant Status** (Compliant / Watch / Breach)
- **Health Status** (Ahead / On Track / At Risk / Critical)

#### Click to Expand — See:
1. **Key Metrics**: Principal paid, Interest paid, Paydown %, Overdue count
2. **Covenant Breaches** (if any) — List with details
3. **Holdings Table**: Each stock with shares, cost, current value, unrealized P&L, return %, dividends
4. **Underperforming Holdings** — Flagged with substitution recommendations
5. **Upcoming Milestones** — With "Settle" buttons

#### Substitution Workflow:
1. Click an underperforming stock's recommendation
2. System sells the old stock, buys the new one
3. Records realized P&L, updates holdings
4. Tracks substitution history

#### Settle Milestone:
1. Click **"Settle"** on a due/overdue milestone
2. Enter amount, source (dividends/sales/external), notes
3. Updates campaign status; completes when all paid

---

## Workflow Summary

```
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  DESIGN     │───▶│   SIMULATE   │───▶│    SAVE /        │
│  (Tranches  │    │   (Risk      │    │    LAUNCH        │
│   + Stocks) │    │   Metrics)   │    │    Campaign      │
└─────────────┘    └──────────────┘    └────────┬─────────┘
                                                │
                                                ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐
│  COMPLETE   │◀───│   MANAGE     │◀───│   TRACK LIVE     │
│  (All Paid) │    │   (Substitute│    │   (Progress,     │
│             │    │   , Settle)  │    │    Covenants)    │
└─────────────┘    └──────────────┘    └──────────────────┘
```

---

## Common Scenarios

### Scenario 1: Conservative Business Expansion
- **Loan**: ₦10M term, 15% fixed, 24 months, amortized monthly
- **Strategy**: Dividend Focus
- **Covenants**: DSCR ≥ 1.5, LTV ≤ 70%
- **Goal**: Use steady dividends to cover payments, keep upside

### Scenario 2: Aggressive Growth Play
- **Loan**: ₦5M bridge, 22% fixed, 12 months, bullet
- **Strategy**: High Conviction
- **Covenants**: DSCR ≥ 1.2, LTV ≤ 85%
- **Goal**: Concentrated bet on 3 high-growth stocks, pay at maturity

### Scenario 3: Revolving Working Capital
- **Loan**: ₦8M revolving, SOFR+3%, 36 months, IO 6mo then amortized
- **Strategy**: Balanced
- **Covenants**: DSCR ≥ 1.25, LTV ≤ 75%
- **Goal**: Draw/repay as needed, commitment fee on undrawn

---

## Tips for Success

1. **Start conservative** — Lower LTV, higher DSCR covenants give breathing room
2. **Diversify** — Don't put 80% in one stock; the system caps at 25% per position
3. **Watch DSCR closely** — It's your early warning system
4. **Use stress tests** — If combined shock breaks you, reduce leverage
5. **Rebalance proactively** — Substitute underperformers before they drag covenants
6. **Settle on time** — Overdue payments flip campaign to "In Default"

---

## Data Persistence

| Data | Storage | Key |
|------|---------|-----|
| Saved Scenarios | localStorage | `idofera_bank_loan_scenarios` |
| Live Campaigns | localStorage | `idofera_bank_loan_campaigns` |

Data survives browser refresh. Export/import not yet implemented.

---

## Limitations & Assumptions

- **Stock prices simulated** — No live market feed; uses Product retailPrice as proxy
- **Dividends estimated** — 35% of expected return allocated to yield
- **No tax modeling** — Interest expense deductibility not calculated
- **No FX risk** — All NGN assumed
- **Linear liquidation** — Portfolio inflows assume steady realization
- **Single currency** — NGN only

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Unallocated capital" warning | Adjust quantities or switch strategy |
| DSCR always < 1.0 | Reduce loan amount, increase tenure, or pick higher-yield strategy |
| LTV breach at start | Lower loan amount or add more capital |
| Campaign shows "No live data" | Click Refresh on expanded card |
| Substitution doesn't appear | Ensure incoming stock not already in portfolio |

---

## Need Help?

- **Simulator not running?** Check that Products have costPrice < retailPrice and status = Active
- **No stocks showing?** Need at least 3 active products with positive margin
- **Tests failing?** Run `npx vitest run src/utils/loanEngine.test.ts`

---

*This feature is part of the Finance & Treasury Hub. It complements the existing Capital Investment & Inventory Planner — use that for inventory-backed investments, this for stock-market-backed loan investments.*