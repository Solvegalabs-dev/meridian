import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { VerticalConfig } from './verticalTypes';

export const getVerticalConfig = cache(async (
  institutionId: string
): Promise<VerticalConfig | null> => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('vertical_config')
    .select('id, institution_id, vertical_type, case_schema, objective_templates, signal_sources, ui_theme, pricing_model, macro_event_categories')
    .eq('institution_id', institutionId)
    .maybeSingle();

  if (error) {
    console.error('[getVerticalConfig] query error:', error.message);
    return null;
  }
  return data ?? null;
});
