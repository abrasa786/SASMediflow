/**
 * Starter dental explainers in plain language. These are DRAFTS: the dentist must read, correct and approve each one
 * before sharing it (they are saved unpublished, with no prices). Adding a service = adding an object here.
 */
export interface TreatmentDraft {
  name: string; category: string; summary: string; why_needed: string; steps: string[];
  duration_text: string; pain_text: string; aftercare: string; delay_risk: string; faqs: { q: string; a: string }[];
}

export const STARTER_LIBRARY: TreatmentDraft[] = [
  {
    name: "Tooth extraction", category: "Surgery",
    summary: "Gently removing a tooth that cannot be saved or is causing problems.",
    why_needed: "A tooth that is badly broken, infected or crowding others can keep causing pain and harm the teeth and gums around it. Removing it stops the problem at its source.",
    steps: ["Examination and X-ray", "Local anaesthesia so the area is numb", "Careful removal of the tooth", "Gauze and instructions to control bleeding"],
    duration_text: "Usually 20 to 45 minutes, in one visit.",
    pain_text: "The area is numbed first, so you should feel pressure but not pain. Some soreness can follow for a day or two.",
    aftercare: "Bite on the gauze for 30 minutes. Avoid rinsing hard, spitting, smoking and hot food for 24 hours. Take only the medicines your dentist prescribes.",
    delay_risk: "An infected tooth can spread infection, cause swelling and damage nearby teeth and bone.",
    faqs: [
      { q: "Will it hurt?", a: "The area is numbed, so you should feel pressure only. Tell the dentist if you feel any pain." },
      { q: "Can I replace the missing tooth?", a: "Yes. Options such as a bridge or an implant can be discussed after healing." },
    ],
  },
  {
    name: "Braces (orthodontic treatment)", category: "Orthodontics",
    summary: "Gradually moving crooked or crowded teeth into a healthier, better-looking position.",
    why_needed: "Crooked or crowded teeth are harder to clean and can wear unevenly. Straighter teeth are easier to keep healthy and improve the bite and smile.",
    steps: ["Check-up, X-rays and a treatment plan", "Fitting the braces", "Regular adjustment visits", "Removal, then a retainer to hold the result"],
    duration_text: "Usually 12 to 24 months, with a visit every few weeks.",
    pain_text: "Mild soreness for a few days after fitting and after tightening is common and settles quickly.",
    aftercare: "Brush after every meal, use the brushes the dentist suggests, avoid very hard or sticky food, and wear the retainer as told.",
    delay_risk: "Crowding can make cleaning harder and may increase the chance of cavities and gum problems over time.",
    faqs: [
      { q: "What is the right age?", a: "Treatment can start for children and also for adults. Your dentist will advise after an examination." },
      { q: "Can I pay in instalments?", a: "Ask the clinic about monthly payment options." },
    ],
  },
  {
    name: "Root canal treatment", category: "Endodontics",
    summary: "Cleaning an infected tooth from the inside so you can keep it.",
    why_needed: "When the nerve inside a tooth is infected, it causes pain and swelling. Cleaning and sealing the tooth removes the infection and often saves the tooth.",
    steps: ["Numbing the tooth", "Removing the infected tissue", "Cleaning and shaping the inside", "Filling and sealing, then usually a crown"],
    duration_text: "One to three visits, each around 30 to 60 minutes.",
    pain_text: "It is done under local anaesthesia and most people say it feels similar to having a filling.",
    aftercare: "Avoid chewing hard food on that tooth until it is fully restored. Finish any prescribed medicines.",
    delay_risk: "The infection can spread, cause abscess and swelling, and may lead to losing the tooth.",
    faqs: [
      { q: "Is a crown needed?", a: "Often yes, because a treated tooth can be weaker. The dentist will tell you." },
    ],
  },
  {
    name: "Teeth cleaning (scaling and polishing)", category: "Preventive",
    summary: "Removing plaque and tartar to keep gums healthy and teeth fresh.",
    why_needed: "Brushing cannot remove hardened tartar. Left alone, it irritates the gums, causes bleeding and bad breath, and can lead to gum disease.",
    steps: ["Examination", "Ultrasonic scaling to remove tartar", "Polishing", "Advice for home care"],
    duration_text: "About 30 to 45 minutes.",
    pain_text: "Usually painless. Sensitive teeth may feel a little tingling for a short while.",
    aftercare: "Mild sensitivity can occur for a day or two. Brush gently with a soft brush.",
    delay_risk: "Untreated tartar can lead to bleeding gums, gum disease and loose teeth.",
    faqs: [
      { q: "How often should I do it?", a: "Usually every six months, or as your dentist advises." },
      { q: "Does it weaken teeth?", a: "No. It removes deposits and helps the gums heal." },
    ],
  },
  {
    name: "Teeth whitening", category: "Cosmetic",
    summary: "Safely lightening the colour of teeth for a brighter smile.",
    why_needed: "Tea, coffee, smoking and age can stain teeth. Whitening lightens stains that cleaning alone cannot remove.",
    steps: ["Check-up and cleaning", "Protecting the gums", "Applying the whitening agent", "Checking the shade and aftercare advice"],
    duration_text: "Usually about an hour in one visit.",
    pain_text: "Some people feel temporary sensitivity for a day or two.",
    aftercare: "Avoid tea, coffee, red wine and smoking for the first 48 hours.",
    delay_risk: "Not a medical risk. Staining can slowly deepen over time.",
    faqs: [
      { q: "How long does it last?", a: "Often one to two years, depending on habits such as tea, coffee and smoking." },
    ],
  },
  {
    name: "Dental filling", category: "Restorative",
    summary: "Repairing a cavity so the tooth stays strong and pain-free.",
    why_needed: "A cavity keeps growing deeper if not treated. A filling removes the decay and restores the tooth early, which is simpler and cheaper than treating it later.",
    steps: ["Numbing if needed", "Removing the decayed part", "Placing the filling", "Shaping and polishing"],
    duration_text: "About 30 to 45 minutes.",
    pain_text: "Usually comfortable. Numbing is used when needed.",
    aftercare: "Avoid chewing on that side until the numbness goes. Mild sensitivity can occur for a few days.",
    delay_risk: "The cavity can reach the nerve, leading to pain and the need for a root canal.",
    faqs: [
      { q: "Can I eat right after?", a: "Wait until the numbness wears off, then avoid very hard food at first." },
    ],
  },
  {
    name: "Dental crown (cap)", category: "Restorative",
    summary: "A custom cover that protects and restores a weak or damaged tooth.",
    why_needed: "A cracked, heavily filled or root-canal-treated tooth can break. A crown protects it and restores its shape and strength.",
    steps: ["Preparing the tooth", "Taking a measurement of the teeth", "Temporary crown while the final one is made", "Fitting the final crown"],
    duration_text: "Usually two visits.",
    pain_text: "The tooth is numbed during preparation.",
    aftercare: "Clean around the crown as usual. Avoid biting very hard objects.",
    delay_risk: "A weak tooth may break and may then be harder to save.",
    faqs: [
      { q: "How long does a crown last?", a: "Many last years with good care. Your dentist will explain the options and materials." },
    ],
  },
  {
    name: "Dental implant", category: "Restorative",
    summary: "A fixed replacement for a missing tooth that is anchored in the jaw.",
    why_needed: "A gap can let nearby teeth drift and makes chewing harder. An implant replaces the tooth and helps keep the bone around it.",
    steps: ["Assessment and scan", "Placing the implant", "Healing period", "Fitting the crown on top"],
    duration_text: "Takes a few months overall, with several short visits.",
    pain_text: "Done under local anaesthesia. Mild soreness afterwards is usual.",
    aftercare: "Keep the area very clean and follow the dentist's instructions. Attend all review visits.",
    delay_risk: "Bone can shrink over time after a tooth is lost, and neighbouring teeth may shift.",
    faqs: [
      { q: "Am I suitable?", a: "The dentist will check your gums, bone and general health first." },
    ],
  },
  {
    name: "Wisdom tooth removal", category: "Surgery",
    summary: "Taking out a wisdom tooth that is stuck, painful or decaying.",
    why_needed: "Wisdom teeth often do not have room, and can cause repeated pain, infection and damage to the tooth in front. Removing them prevents repeat problems.",
    steps: ["X-ray to see the position", "Local anaesthesia", "Removal of the tooth", "Care instructions and follow-up"],
    duration_text: "Usually 30 to 60 minutes.",
    pain_text: "Numbed first. Swelling and soreness for a few days can be expected and is managed with advice from the dentist.",
    aftercare: "Rest, cold compress as advised, soft food for a few days, and no rinsing hard or smoking for 24 hours.",
    delay_risk: "Repeated infection and swelling, and possible damage to the neighbouring tooth.",
    faqs: [
      { q: "Do all wisdom teeth need removal?", a: "No. Only those causing or likely to cause problems. The dentist will advise." },
    ],
  },
  {
    name: "Children's dental care", category: "Paediatric",
    summary: "Gentle check-ups, cleaning and cavity prevention for children.",
    why_needed: "Healthy milk teeth help children chew, speak and guide the adult teeth into place. Early care avoids pain and bigger treatments later.",
    steps: ["Friendly check-up", "Cleaning", "Fluoride or sealants if advised", "Brushing guidance for parent and child"],
    duration_text: "About 20 to 30 minutes.",
    pain_text: "Done gently, in a child-friendly way.",
    aftercare: "Help your child brush twice a day and limit sweets and sticky snacks.",
    delay_risk: "Cavities in milk teeth can cause pain and affect the teeth that come after.",
    faqs: [
      { q: "When should the first visit be?", a: "Usually when the first teeth appear, or by the first birthday." },
    ],
  },
  {
    name: "Gum treatment", category: "Periodontics",
    summary: "Treating bleeding, swollen or receding gums and bad breath.",
    why_needed: "Gum disease is a common reason teeth become loose. Treating it early protects the teeth and bone that hold them.",
    steps: ["Gum examination", "Deep cleaning below the gum line", "Medicines or follow-up if advised", "Home care plan"],
    duration_text: "One to several visits, depending on how advanced it is.",
    pain_text: "The gums are numbed if needed. Mild soreness may follow.",
    aftercare: "Brush gently but thoroughly, clean between teeth, and attend the review visits.",
    delay_risk: "The supporting bone can be lost and teeth may become loose.",
    faqs: [
      { q: "Are bleeding gums normal?", a: "No. Bleeding gums are a sign worth checking with the dentist." },
    ],
  },
  {
    name: "Dentures", category: "Restorative",
    summary: "Removable replacements for missing teeth, so you can chew and smile comfortably.",
    why_needed: "Missing teeth make chewing difficult and can change how the face looks. Dentures restore chewing, speech and appearance.",
    steps: ["Examination and measurements", "Trying the shape and shade", "Fitting the dentures", "Adjustments after use"],
    duration_text: "Takes a few visits over a couple of weeks.",
    pain_text: "No pain in making them. New dentures can feel tight at first and are adjusted.",
    aftercare: "Clean them daily and remove them at night as advised.",
    delay_risk: "Chewing becomes harder and nearby teeth can shift into the gaps.",
    faqs: [
      { q: "Will it feel strange?", a: "It can for a week or two. Adjustments help it fit comfortably." },
    ],
  },
];
