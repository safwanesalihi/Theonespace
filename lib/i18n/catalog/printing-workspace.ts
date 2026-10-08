// Translations for the print workspace screens (lib/i18n/printing.ts holds the earlier printing copy).
// French source → [English, Arabic]; see lib/i18n/index.ts.
import type { Catalog } from './types';

export const printingWorkspace: Catalog = {
  "Client entreprise (raison sociale, adresse, RC, ICE, IF sur le document)": ["Company client (company name, address, RC, ICE, IF on the document)", "عميل شركة (الاسم التجاري، العنوان، RC، ICE، IF على المستند)"],
  "Raison sociale": ["Company name", "الاسم التجاري"],
  "Supprimer cette commande ?": ["Delete this order?", "حذف هذه الطلبية؟"],
  "La commande et ses tâches seront définitivement supprimées. Les paiements déjà encaissés restent dans les entrées & sorties, sans commande liée.": ["The order and its tasks will be permanently deleted. Payments already recorded stay in income & expenses, no longer linked to an order.", "سيتم حذف الطلبية ومهامها نهائياً. المدفوعات المسجّلة تبقى في المداخيل والمصاريف دون ارتباط بطلبية."],
  "Supprimer ce paiement ?": ["Delete this payment?", "حذف هذا الدفع؟"],
  "Ce mouvement sera définitivement supprimé et les totaux seront recalculés.": ["This entry will be permanently deleted and the totals recalculated.", "سيتم حذف هذه الحركة نهائياً وإعادة حساب المجاميع."],
  "Supprimer ce document ?": ["Delete this document?", "حذف هذا المستند؟"],
  "Cette facture/devis sera définitivement supprimée.": ["This invoice/quote will be permanently deleted.", "سيتم حذف هذه الفاتورة/عرض السعر نهائياً."],
  "Actions": ["Actions", "إجراءات"],
  "Nom du client": ["Client name", "اسم العميل"],
  "Nouveau document": ["New document", "وثيقة جديدة"],
  "Description de l'article ou service": ["Description of the item or service", "وصف المنتج أو الخدمة"],
  "Nouvelle facture": ["New invoice", "فاتورة جديدة"],
  "Génération du PDF impossible.": ["The PDF could not be generated.", "تعذر إنشاء ملف PDF."],
  "Aucune": ["None", "لا شيء"],
  "Aucune transaction enregistrée": ["No movement recorded", "لا توجد حركة مسجلة"],
  "Prix unit.": ["Unit price", "سعر الوحدة"],
  "Responsable": ["Owner", "المسؤول"],
  "Un nombre, avec virgule si besoin : 12 ou 1,4": ["A number, with a decimal if needed: 12 or 1.4", "رقم، بفاصلة عشرية عند الحاجة: 12 أو 1,4"],
  "Factures": ["Invoices", "الفواتير"],
};
