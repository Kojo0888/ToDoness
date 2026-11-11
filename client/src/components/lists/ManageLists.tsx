import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { LIST_NAME_MAX } from '@todoness/shared';
import { getLists } from '../../data/queries';
import { db, repo } from '../../app/container';
import { dropScope } from '../../lib/dropOrder';
import { t } from '../../app/strings';
import { ManageItems, type ManageText } from '../common/ManageItems';

const TEXT: ManageText = {
  title: t.manage.title,
  back: t.manage.back,
  empty: t.manage.empty,
  renameLabel: t.list.renameLabel,
  deleteItem: t.list.deleteList,
  deleteTitle: t.list.deleteListTitle,
  deleteText: t.list.deleteListText,
  drag: t.manage.drag,
  reorderFailed: t.manage.reorderFailed,
};

/** Rename, reorder (by dragging) and delete lists in one place (the Inbox is fixed). */
export function ManageLists() {
  const stored = useLiveQuery(() => getLists(db), [], []);
  const editable = useMemo(() => stored.filter((l) => !l.isInbox), [stored]);
  return (
    <ManageItems
      items={editable}
      scope={dropScope.lists}
      backHref="/tasks"
      nameMax={LIST_NAME_MAX}
      text={TEXT}
      rename={repo.renameList}
      reorder={repo.reorderList}
      remove={repo.deleteList}
      countOf={(id) =>
        db.todos
          .where('listId')
          .equals(id)
          .filter((x) => x.deletedAt === null)
          .count()
      }
    />
  );
}
