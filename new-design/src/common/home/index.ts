/** Read-only facts for the home page. Task counts never stand in for book counts. */
export interface HomeTaskFact {
  id: string;
  status: string;
  sourceRoute: string;
  updatedAt: string;
}

export interface HomeDirectorFact {
  id: string;
  status: string;
  leaseExpired: boolean;
  chapterCount: number;
  savedCandidateCount: number;
}

export interface HomeBookFact {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
  characterCount: number;
  worldCount: number;
  requiredFieldCount: number;
  filledRequiredFieldCount: number;
  storyPlanCount: number;
  volumePlanCount: number;
  chapterPlanCount: number;
  adoptedChapterPlanCount: number;
  writableChapterPlanCount: number;
  writtenChapterCount: number;
  stableChapterCount: number;
  pendingFacts: number;
  pendingChanges: number;
  openQualityIssues: number;
  staleResources: number;
  pendingDependencyReviews: number;
  runningTasks: number;
  queuedTasks: number;
  waitingTasks: number;
  latestTask: HomeTaskFact | null;
  latestDirector: HomeDirectorFact | null;
}

export interface HomeCreationDraft {
  id: string;
  name: string;
  status: string;
  stage: string;
  progress: number;
  selectedDirection: boolean;
  completedStages: string[];
  mode: string | null;
  updatedAt: string;
}

export interface HomeSnapshot {
  /** All active books from one read-only snapshot; no client-side page limit. */
  books: HomeBookFact[];
  /** Latest unfinished creation session, with its original source identity. */
  creationDraft: HomeCreationDraft | null;
  readAt: string;
}

export interface HomeModelStatus {
  configured: boolean;
  tasks: Array<{ label: string; configured: boolean }>;
}
