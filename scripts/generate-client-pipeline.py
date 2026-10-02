"""Rebuild the editable Figma SVG and the two-page pipeline PDF.
Requires reportlab + svglib. Output contains no real client details or invented rates.
"""
from pathlib import Path
from html import escape
from io import BytesIO
import re, math
from reportlab.pdfgen import canvas
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
W,H=1600,1180
INK='#242730'; MUTED='#626977'; GOLD='#d4af37'; PALE='#fbf7e8'; LINE='#e3e5eb'
class Board:
 def __init__(self,title,subtitle,number):
  self.parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="{GOLD}"/></marker></defs>',f'<rect width="{W}" height="{H}" fill="#f5f6f8"/>']
  self.rect(32,28,1536,124,'#fff',r=24,stroke=LINE)
  self.rect(32,28,12,124,GOLD,r=5)
  self.text('THE ONE FLOW  /  PARCOURS CLIENT',64,64,13,'#806414',bold=True)
  self.text(title,64,103,32,bold=True)
  self.text(subtitle,64,130,15,MUTED)
  self.text(f'0{number} / 02',1485,65,15,MUTED)
 def rect(self,x,y,w,h,fill,r=14,stroke=None): self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"'+(f' stroke="{stroke}"' if stroke else '')+'/>')
 def text(self,t,x,y,size=17,color=INK,bold=False): self.parts.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="Arial, sans-serif" font-size="{size}" font-weight="{700 if bold else 400}">{escape(t)}</text>')
 def lines(self,lines,x,y,size=17,color=MUTED,gap=28):
  for i,l in enumerate(lines): self.text(l,x,y+i*gap,size,color)
 def path(self,d,color=GOLD,dashed=False):
  self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"'+(' stroke-dasharray="6 5"' if dashed else '')+'/>')
  pts=[float(x) for x in re.findall(r'[0-9.]+',d)]; a,b,x,y=pts[-4:]; length=math.hypot(x-a,y-b); u,v=(x-a)/length,(y-b)/length
  self.parts.append(f'<polygon points="{x},{y} {x-8*u-4*v},{y-8*v+4*u} {x-8*u+4*v},{y-8*v-4*u}" fill="{color}"/>')
 def card(self,x,y,n,title,owner,lines,gate,w=340,h=220):
  self.rect(x+2,y+5,w,h,'#e9ebf0',r=20)
  self.rect(x,y,w,h,'#fff',r=20,stroke=LINE)
  self.rect(x+20,y+20,36,36,PALE,r=11)
  self.text(str(n).zfill(2),x+28,y+44,16,'#806414',True)
  self.text(title,x+70,y+44,23,bold=True)
  self.text(owner.upper(),x+20,y+82,12,MUTED,True)
  self.lines(lines,x+20,y+(108 if h<200 else 115),16,gap=(23 if h<200 else 26))
  self.rect(x+20,y+h-42,w-40,25,PALE,r=7)
  self.text(gate,x+30,y+h-24,12,'#725b18',True)
 def finish(self): return '\n'.join(self.parts+['</svg>'])

b=Board('Un accord clair. Une production sereine.','Le même périmètre relie le devis, le contrat, le plan et les demandes supplémentaires.',1)
stages=[
(64,180,1,'Cadrage','Propriétaire + client',['Parties, formats, volumes et unités','Plateformes, langues, adaptations','Durée, droits, prix et exclusions'],'1 FRAME DE STORY = 1 UNITÉ'),
(440,180,2,'Devis','Propriétaire → client',['Offre complète + conditions','Prix HT, TVA et total TTC','Accord ou refus dans le portail'],'ACCORD EXPLICITE SUR CETTE VERSION'),
(816,180,3,'Contrat','Propriétaire → client',['Copie du devis accepté','Périmètre, montants et notes','Preuve d’accord conservée'],'DOCUMENT ENVOYÉ = VERSION FIGÉE'),
(1192,180,4,'Brief','Studio + client',['Identité, audience et objectifs','Exigences et interlocuteur','Accès, photos et informations'],'CADRAGE COMPLET AVANT PRODUCTION'),
(1192,470,5,'Plan','Studio + client',['Plan éditorial du mois','Un nœud Story = un frame','Volumes rapprochés du forfait'],'BRIEF J−14  ·  CALENDRIER GELÉ J−7'),
(816,470,6,'Production','Studio + assigné',['Tâches, dates et responsabilités','Lien du livrable → validation','Travail inclus ou extra accepté'],'LES EXTRAS SUIVENT LEUR DEVIS'),
(440,470,7,'Validation','Client + studio',['Retours consolidés dans le portail','2 tours inclus par livrable','3e tour : pause et devis extra'],'48 H : LIVRABLES UNIQUEMENT'),
(64,470,8,'Bilan','Propriétaire + client',['Livraison et publication','Facture, paiement et bilan','Renouvellement du périmètre'],'NOUVEAU PÉRIMÈTRE = NOUVEL ACCORD')]
for args in stages: b.card(*args)
for x in [404,780,1156]: b.path(f'M{x},290 L{x+26},290')
b.path('M1362,405 L1362,460')
for x in [1182,806,430]: b.path(f'M{x},580 L{x-26},580')
b.rect(64,722,1468,68,PALE,r=16,stroke='#eadba4')
b.text('UNE SEULE RÉFÉRENCE COMMERCIALE',86,749,12,'#806414',True)
b.text('Quantités + définitions + adaptations + retours + délais + paiement + durée + droits + tarifs des extras',86,776,19,bold=True)
b.text('DEMANDE SUPPLÉMENTAIRE  /  LE CHEMIN DES EXTRAS',64,839,16,'#806414',True)
extras=[('Demande','Client → portail',['Contenu, nouveau besoin','ou tour supplémentaire']),('Qualification','Studio',['Inclus : quota disponible','Sinon : extra à chiffrer']),('Devis extra','Propriétaire',['Format + quantité exacte','Prix saisi, jamais inventé']),('Accord explicite','Client',['Accepter ou refuser','Aucun accord par silence']),('Reprise','Studio + assigné',['Créer la tâche extra','ou reprendre le livrable'])]
for i,(title,owner,lines) in enumerate(extras):
 x=64+i*298; b.card(x,865,i+1,title,owner,lines,'DEVIS LIÉ À LA DEMANDE',w=276,h=182)
 if i<4:b.path(f'M{x+280},955 L{x+292},955')
b.text('Refus ou devis non accepté : aucun extra en production. Un tour hors forfait met le livrable original en pause.',64,1083,17,MUTED)
b.text('Les programmations sociales et reposts ne sont pas comptés une seconde fois dans la création originale.',64,1111,17,MUTED)
b.text('Document de travail · 02 octobre 2026 · SVG éditable : glisser dans Figma',64,1151,12,MUTED)
svg=b.finish(); (OUT/'client-pipeline.svg').write_text(svg)

c=Board('Ce qui doit être écrit dans chaque accord.','Une checklist commerciale à compléter avec vos vrais tarifs et vos conditions.',2)
blocks=[
('01  Parties et livrables',['Raison sociale, adresse et identifiants.','Quantité par format et par période.','1 frame de story = 1 unité : 5 frames = 5.','Carrousel : nombre maximal de slides.','Reel : durée, tournage et sous-titres.','Shooting : durée, lieu et frais inclus.']),
('02  Adaptations et exclusions',['Réseaux et langues inclus, par format.','Adaptation, recadrage et repost : préciser.','Community management et horaires.','Budget publicitaire, impressions, déplacements.','Unités inutilisées : report écrit ou aucun.']),
('03  Retours et validations',['Nom du contact qui valide les contenus.','2 tours consolidés inclus par livrable.','48 h pour les livrables selon l’accord.','Silence ≠ accord sur un devis ou un extra.','Nouveau contenu ou direction : qualifier.']),
('04  Calendrier et responsabilités',['Dates de début et de fin de prestation.','Logo, photos, accès et brief à fournir.','Brief J−14 · envoi J−7 · validation J−5.','Prêt J−1 · gel du calendrier J−7.','Retard client ou exception : accord studio.']),
('05  Prix, paiement et fin de contrat',['Prix HT, TVA et total TTC.','Échéances et modalités de paiement.','Renouvellement et préavis de résiliation.','Droits d’usage, musique et fichiers sources.','Extras : tarif unitaire ou devis séparé.']),
('06  Accord et traçabilité',['Devis envoyé puis accepté explicitement.','Contrat issu de ce devis, mêmes conditions.','Numéro, version, identité et horodatage.','Document envoyé : contenu non réécrit.','Conserver document signé / preuve d’accord.'])]
for i,(title,lines) in enumerate(blocks):
 x=64+(i%3)*498;y=186+(i//3)*320
 c.rect(x+2,y+5,470,286,'#e9ebf0',r=20);c.rect(x,y,470,286,'#fff',r=20,stroke=LINE)
 c.text(title,x+24,y+43,21,bold=True);c.lines(lines,x+24,y+85,17,gap=36)
c.rect(64,842,1468,195,PALE,r=20,stroke='#eadba4')
c.text('MODE D’EMPLOI DANS L’APP',88,881,15,'#806414',True)
c.lines(['Client → Pipeline & documents → Définir le forfait → Créer le devis → Envoyer.',
         'Client : Documents → lire les conditions → accepter. Studio : Créer le contrat depuis le devis accepté.',
         'Demandes → qualifier inclus / extra → créer et envoyer le devis extra → attendre son accord → produire.'],88,918,20,INK,gap=36)
c.text('Les tarifs restent à renseigner. Les anciennes prestations ne sont pas requalifiées automatiquement.',64,1083,16,MUTED)
c.text('Le portail conserve une décision authentifiée ; il ne prétend pas fournir une signature électronique certifiée.',64,1112,16,MUTED)
c.text('Référence : DGSSI · loi 43-20 relative aux services de confiance pour les transactions électroniques.',64,1151,12,MUTED)
svg2=c.finish();(OUT/'client-contract-checklist.svg').write_text(svg2)
pdf=canvas.Canvas(str(OUT/'client-pipeline-blueprint.pdf'),pagesize=(W,H))
pdf.setTitle('The One Flow — Pipeline client et périmètre commercial');pdf.setAuthor('The One Core')
for source in [svg,svg2]:
 drawing=svg2rlg(BytesIO(source.encode()));drawing.scale(W/drawing.width,H/drawing.height);renderPDF.draw(drawing,pdf,0,0);pdf.showPage()
pdf.save()
print('Created editable SVG diagram + two-page PDF checklist.')
