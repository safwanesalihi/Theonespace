// Every translation catalog, one per area of the app. Each French key lives in exactly one catalog
// (tests/i18n.mjs checks it), so the order below never decides a translation.
import { activity } from './activity';
import { assistant } from './assistant';
import { auth } from './auth';
import { clients } from './clients';
import { common } from './common';
import { contentPlan } from './content-plan';
import { crm } from './crm';
import { dashboard } from './dashboard';
import { documents } from './documents';
import { flow } from './flow';
import { igAnalyzer } from './ig-analyzer';
import { landing } from './landing';
import { library } from './library';
import { meetings } from './meetings';
import { pages } from './pages';
import { plans } from './plans';
import { platform } from './platform';
import { portal } from './portal';
import { recordsApi } from './records-api';
import { requests } from './requests';
import { rules } from './rules';
import { shoots } from './shoots';
import { social } from './social';
import { studio } from './studio';
import { tasks } from './tasks';
import { team } from './team';
import { workspace } from './workspace';
import type { Catalog } from './types';

export const catalogs: Record<string, Catalog> = { activity, assistant, auth, clients, common, 'content-plan': contentPlan, crm, dashboard, documents, flow, 'ig-analyzer': igAnalyzer, landing, library, meetings, pages, plans, platform, portal, 'records-api': recordsApi, requests, rules, shoots, social, studio, tasks, team, workspace };

const column = (index: 0 | 1) => Object.fromEntries(Object.values(catalogs).flatMap((catalog) => Object.entries(catalog).map(([fr, pair]) => [fr, pair[index]])));
export const catalogEn: Record<string, string> = column(0);
export const catalogAr: Record<string, string> = column(1);
