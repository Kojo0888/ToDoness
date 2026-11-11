import { useLiveQuery } from 'dexie-react-hooks';
import { PLAN_NAME_MAX } from '@todoness/shared';
import { getActivities, getPlans } from '../../data/queries';
import { db, repo } from '../../app/container';
import { dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ManageItems, type ManageText } from '../common/ManageItems';

export const MANAGE_PLANS_PATH = '/plans/manage';

const TEXT: ManageText = {
  title: t.managePlans.title,
  back: t.managePlans.back,
  empty: t.managePlans.empty,
  renameLabel: t.plan.nameLabel,
  deleteItem: t.plan.deletePlan,
  deleteTitle: t.plan.deletePlanTitle,
  deleteText: t.plan.deletePlanText,
  drag: t.managePlans.drag,
  reorderFailed: t.managePlans.reorderFailed,
};

/** Rename, reorder and delete plans, like Manage lists (docs/plan/PRD.md FR-121). */
export function ManagePlans() {
  const plans = useLiveQuery(() => getPlans(db), [], []);
  return (
    <ManageItems
      items={plans}
      scope={dropScope.plans}
      backHref="/plans"
      nameMax={PLAN_NAME_MAX}
      text={TEXT}
      rename={repo.renamePlan}
      reorder={repo.reorderPlan}
      remove={repo.deletePlan}
      countOf={async (id) => (await getActivities(db, id)).length}
    />
  );
}
