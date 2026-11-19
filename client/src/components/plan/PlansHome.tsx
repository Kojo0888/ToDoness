import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { PLAN_NAME_MAX } from '@todoness/shared';
import { getPlans } from '../../data/queries';
import { db, repo } from '../../app/container';
import { t } from '../../app/strings';
import { useSubmitGuard } from '../../lib/submitGuard';

export const planPath = (id: string) => `/plan/${id}`;

/**
 * The start of the Plan module (docs/plan/PRD.md FR-122): the first plan, or, with no plan
 * yet, a field to name the first one (on a phone the sidebar with "new plan" is closed).
 */
export function PlansHome() {
  const [, navigate] = useLocation();
  const plans = useLiveQuery(() => getPlans(db), []);
  const [name, setName] = useState('');
  const guard = useSubmitGuard(); // one press, one plan (docs/unstable-connection FR-255)

  if (plans === undefined) return null;
  if (plans[0]) return <Redirect to={planPath(plans[0].id)} replace />;

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = await guard.run(() => repo.createPlan(trimmed));
    if (result.ran) navigate(planPath(result.value.id));
  }

  return (
    <section className="plan-page" aria-label={t.modules.plan}>
      <h2>{t.modules.plan}</h2>
      <p className="empty">{t.plan.empty}</p>
      <form onSubmit={create} className="plan-first">
        <input
          type="text"
          aria-label={t.plan.firstPlan}
          placeholder={t.plan.firstPlan}
          value={name}
          maxLength={PLAN_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="primary" disabled={guard.busy} aria-busy={guard.busy}>
          {t.plan.createPlan}
        </button>
      </form>
    </section>
  );
}
