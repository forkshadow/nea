# Outil Cerfa (MVP local navigateur)

Page disponible sur **`/cerfa/`**.

## Test rapide
1. Ouvrir `https://<votre-site-github-pages>/cerfa/`.
2. Charger des images via **Choisir un fichier** ou **Prendre une photo** (simple/avancé).
3. Cliquer sur **Analyser** (OCR local, barre de progression).
4. Vérifier/corriger le formulaire pré-rempli.
5. Cliquer sur **Générer PDF** pour télécharger le récapitulatif, ou **Imprimer**.

## Confidentialité
- Traitement local dans le navigateur.
- Aucun envoi réseau volontaire par l'application.
- Aucun stockage persistant côté application.

## Note technique
Ce MVP inclut des fichiers de librairie locaux dans `cerfa/lib/` (`tesseract.min.js` et `pdf-lib.min.js` ou équivalents) pour rester sans build et autonome sur GitHub Pages.
