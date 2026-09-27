// lib/fac/signalCategoryMapper.ts

export interface ObjectiveContext {
  title: string;
  description?: string;
  vertical: 'arc' | 'auto_finance' | 'real_estate' | 'credit_union';
  tags?: string[];
}

export interface SignalCategory {
  category: string;
  searchTerms: string[];
  rationale: string;
}

export function mapSignalCategories(ctx: ObjectiveContext): SignalCategory[] {
  const categories: SignalCategory[] = [];
  const titleLower = ctx.title.toLowerCase();
  const descLower = (ctx.description ?? '').toLowerCase();
  const combined = `${titleLower} ${descLower}`;

  // --- ARC VERTICAL ---
  if (ctx.vertical === 'arc') {

    // Hunting / Outdoors
    if (/hunt|elk|deer|tag|cwmu|season|wildlife/.test(combined)) {
      categories.push({
        category: 'drought_and_precipitation',
        searchTerms: ['USGS drought monitor', 'Utah drought index current', 'precipitation forecast Utah'],
        rationale: 'Drought conditions move elk off CWMU properties weeks before hunt windows close'
      });
      categories.push({
        category: 'wildlife_movement',
        searchTerms: ['Utah elk movement 2026', 'CWMU elk herd reports', 'Utah DWR elk conditions'],
        rationale: 'Wildlife agency reports surface herd position data before hunt window opens'
      });
      categories.push({
        category: 'hunt_window_weather',
        searchTerms: ['10 day forecast Utah mountains', 'NOAA extended forecast Utah'],
        rationale: '10-day forecast within 30 days of hunt window is a material confidence signal'
      });
    }

    // Career / Aviation
    if (/captain|upgrade|bid|airline|pilot|fo|first officer|endeavor|alaska|united|delta/.test(combined)) {
      categories.push({
        category: 'airline_hiring_signals',
        searchTerms: ['Endeavor Air captain vacancies 2026', 'regional airline hiring freeze', 'FAA pilot shortage 2026', 'ALPA contract negotiations'],
        rationale: 'Airline vacancy and hiring signals are leading indicators of bid award timing'
      });
      categories.push({
        category: 'aviation_regulatory',
        searchTerms: ['DOT pilot shortage report 2026', 'FAA medical certification changes', 'ATP certificate rule changes'],
        rationale: 'Regulatory changes can compress or expand upgrade timelines'
      });
    }

    // Financial / Investment
    if (/invest|portfolio|stock|market|robinhood|trading|retire/.test(combined)) {
      categories.push({
        category: 'market_conditions',
        searchTerms: ['Federal Reserve rate decision 2026', 'S&P 500 outlook', 'market volatility index VIX'],
        rationale: 'Macro market signals materially affect investment objective confidence'
      });
    }

    // Real Estate / Personal
    if (/home|house|mortgage|buy|sell|listing|property/.test(combined)) {
      categories.push({
        category: 'rate_environment',
        searchTerms: ['Freddie Mac mortgage rate weekly 2026', 'rate lock window trends', '30 year fixed mortgage rate today'],
        rationale: 'Rate movements within 60 days of purchase/listing target are high-confidence signals'
      });
    }
  }

  // --- REAL ESTATE VERTICAL (Fusion) ---
  if (ctx.vertical === 'real_estate') {
    categories.push({
      category: 're_market_velocity',
      searchTerms: ['Salt Lake City days on market 2026', 'Utah real estate DOM trend', 'Realtor.com housing market hotness'],
      rationale: 'DOM acceleration is the leading indicator of listing stall or sale velocity'
    });
    categories.push({
      category: 're_rate_environment',
      searchTerms: ['Freddie Mac 30 year rate weekly', 'mortgage application volume MBA', 'rate lock expiry trends 2026'],
      rationale: 'Rate lock windows and application volume predict buyer urgency in active pipeline'
    });
    categories.push({
      category: 're_inventory',
      searchTerms: ['Utah housing inventory 2026', 'new listings Salt Lake', 'absorption rate Utah county'],
      rationale: 'Inventory changes shift list-to-sale ratios within 30-60 day windows'
    });
  }

  // --- AUTO FINANCE / CREDIT UNION VERTICAL (Fusion) ---
  if (ctx.vertical === 'auto_finance' || ctx.vertical === 'credit_union') {
    categories.push({
      category: 'credit_stress_indicators',
      searchTerms: ['auto loan delinquency rate 2026', 'subprime auto lending trends', 'insurance lapse leading indicator default'],
      rationale: 'Insurance lapses are the primary leading indicator of impending auto loan default'
    });
    categories.push({
      category: 'macro_credit_environment',
      searchTerms: ['Federal Reserve rate decision 2026', 'CFPB enforcement actions auto', 'NCUA examination priorities 2026'],
      rationale: 'Regulatory and rate signals shift portfolio risk within 30-90 day windows'
    });
    categories.push({
      category: 'collateral_risk',
      searchTerms: ['Manheim used vehicle index 2026', 'repo volume trends', 'used car market value decline'],
      rationale: 'Collateral value changes directly affect loss-given-default on at-risk accounts'
    });
  }

  // Fallback
  if (categories.length === 0) {
    categories.push({
      category: 'general_conditions',
      searchTerms: [ctx.title, `${ctx.title} news 2026`, `${ctx.title} market conditions`],
      rationale: 'General horizon monitoring for objective-specific conditions'
    });
  }

  return categories;
}
