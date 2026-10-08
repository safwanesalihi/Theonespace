// Translations for features/documents.
// French source → [English, Arabic]; see lib/i18n/index.ts.
import type { Catalog } from './types';

export const documents: Catalog = {
  "Règles personnalisées pour ce client": ["Custom rules for this client", "قواعد مخصصة لهذا العميل"],
  "Les contrats acceptés et les validations en cours gardent leurs règles. Ces valeurs servent aux nouveaux devis et aux livrables sans contrat accepté.": ["Accepted contracts and current approvals keep their rules. These values apply to new quotes and deliverables without an accepted contract.", "تحتفظ العقود المقبولة والموافقات الجارية بقواعدها. تُستخدم هذه القيم لعروض الأسعار الجديدة والمخرجات دون عقد مقبول."],
  "Les devis et les extras sont acceptés explicitement ; le délai de {hours} h concerne les livrables.": ["Quotes and extras require explicit acceptance; the {hours}-hour deadline applies to deliverables.", "تتطلب عروض الأسعار والإضافات موافقة صريحة؛ مهلة {hours} ساعة تخص المخرجات."],
  "Nouveau {type}": ["New {type}", "جديد {type}"],
  "Créez un devis, une facture ou un contrat pour ce client.": ["Create a quote, invoice or contract for this client.", "أنشئوا عرض سعر أو فاتورة أو عقدًا لهذا العميل."],
  "Sous-total": ["Subtotal", "المجموع الفرعي"],
  "TVA (%)": ["VAT (%)", "الضريبة (%)"],
  "Ce document a été envoyé : ses lignes et son montant ne peuvent plus changer. Archivez-le pour en créer un nouveau.": ["This document has been sent: its lines and amount can no longer change. Archive it to create a new one.", "تم إرسال هذا المستند: لم يعد بالإمكان تغيير بنوده أو مبلغه. أرشفوه لإنشاء مستند جديد."],
  "Supprimer ce brouillon ?": ["Delete this draft?", "حذف هذه المسودة؟"],
  "« {number} » sera définitivement supprimé.": ["“{number}” will be permanently deleted.", "سيُحذف «{number}» نهائيًا."],
  "Archivage impossible. Réessayez.": ["Archiving failed. Try again.", "تعذرت الأرشفة. حاولوا مجددًا."],
  "Suppression impossible. Réessayez.": ["Deletion failed. Try again.", "تعذر الحذف. حاولوا مجددًا."],
};
