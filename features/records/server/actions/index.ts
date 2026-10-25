// The /api/records action chain, in the order the requests are tried. The order is part of the contract:
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
import { answerShoot, closeShoot, saveShoot } from './shoots';
import { convertProspect, deleteProspect, moveProspect, saveProspect } from './crm';
import { changeMember, inviteMember, renewInvitation, setMemberTitles, setMemberWhatsapp } from './members';
import { markRead, notifyClient, updateProfile } from './profile';
import { saveRecord } from './records';
import { decideRequest, submitRequest, updateRequest } from './requests';
import { remindAssigneeWhatsapp, retryApprovalWhatsapp } from './task-whatsapp';
import { requestPlan, setBrand, setWorkflowSettings } from './workspace-settings';
import { saveProcess } from './process';

export const actionChain: readonly ActionStep[] = [
  requestPlan,
  setWorkflowSettings,
  saveProcess,
  setBrand,
  // the team
  inviteMember,
  renewInvitation,
  remindAssigneeWhatsapp,
  retryApprovalWhatsapp,
  setMemberWhatsapp,
  setMemberTitles,
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
  // shooting sessions
  saveShoot,
  closeShoot,
  answerShoot,
  // the CRM
  saveProspect,
  moveProspect,
  convertProspect,
  deleteProspect,
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
