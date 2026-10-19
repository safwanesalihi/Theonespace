// The /api/records action chain, in the order the requests are tried. The order is part of the contract:
// - `request-plan` answers before the print workspace gate, which refuses whatever print doesn't share;
// - the kind-specific deletes (library, platform, document) come before the generic delete;
// - `library-favorite` / `library-used` from a non-studio role match nothing and get « Action invalide »;
// - the generic client / project / task save comes last.
import type { ActionStep } from '../context';
import { approveTask, internalReview, publishTask, requestTaskChanges, trackTime } from './approval';
import { chatReceipt, comment, commentDelete } from './chat';
import { deleteManyTasks, deleteRecord } from './deletion';
import { deleteDocument, documentDecision, saveDocument } from './documents';
import { postDecision, postMarkPublished, saveEditorialPost, seriesDate } from './editorial';
import { deleteLibraryItem, deletePlatform, libraryInteraction, saveLibraryItem, savePlatform } from './library';
import { cancelMeeting, endMeeting, saveMeeting } from './meetings';
import { changeMember, createPrintWorkspace, inviteMember, renewInvitation, setMemberTitles, setMemberWhatsapp, setPrintAccess } from './members';
import { markRead, notifyClient, updateProfile } from './profile';
import { saveRecord } from './records';
import { decideRequest, submitRequest, updateRequest } from './requests';
import { remindAssigneeWhatsapp, retryApprovalWhatsapp } from './task-whatsapp';
import { printWorkspaceGate, requestPlan, setBrand, setWorkflowSettings } from './workspace-settings';

export const actionChain: readonly ActionStep[] = [
  requestPlan,
  printWorkspaceGate,
  setWorkflowSettings,
  setBrand,
  // the team
  inviteMember,
  createPrintWorkspace,
  renewInvitation,
  remindAssigneeWhatsapp,
  retryApprovalWhatsapp,
  setMemberWhatsapp,
  setMemberTitles,
  setPrintAccess,
  changeMember,
  // the task conversation
  chatReceipt,
  comment,
  commentDelete,
  // validation, publication, time
  internalReview,
  approveTask,
  requestTaskChanges,
  publishTask,
  trackTime,
  // meetings
  saveMeeting,
  endMeeting,
  cancelMeeting,
  // documents and requests
  documentDecision,
  submitRequest,
  updateRequest,
  decideRequest,
  // deletions
  deleteLibraryItem,
  deletePlatform,
  deleteDocument,
  deleteManyTasks,
  deleteRecord,
  // the person
  updateProfile,
  markRead,
  notifyClient,
  // library, platforms, social calendar, documents
  libraryInteraction,
  saveLibraryItem,
  savePlatform,
  saveEditorialPost,
  seriesDate,
  postDecision,
  postMarkPublished,
  saveDocument,
  // clients, sub-projects, tasks
  saveRecord,
];
