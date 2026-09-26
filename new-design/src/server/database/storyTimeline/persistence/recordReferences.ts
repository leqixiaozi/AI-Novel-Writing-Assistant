/** Reference identities retained when story data is persisted as cards. */
export const storyRecordReferences:Record<string,Array<{field:string;query?:string;kind?:string}>>={
  "canonical_fact": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "subject_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "object_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "supersedes_fact_id",
      "kind": "canonical_fact"
    },
    {
      "field": "superseded_by_fact_id",
      "kind": "canonical_fact"
    }
  ],
  "state_change_proposal": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "cause_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "story_time_proposal_version": [
    {
      "field": "proposal_id",
      "kind": "story_time_proposal"
    },
    {
      "field": "relative_to_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "fact_id",
      "kind": "canonical_fact"
    },
    {
      "field": "state_proposal_id",
      "kind": "state_change_proposal"
    }
  ],
  "story_time_proposal": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "story_time_position": [
    {
      "field": "space_id",
      "query": "SELECT 1 FROM new_design.card_spaces WHERE id=$1"
    },
    {
      "field": "card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "story_event_narrative_occurrence": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "scene_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "source_time_proposal_version_id",
      "kind": "story_time_proposal_version"
    }
  ],
  "story_event_timing": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "proposal_id",
      "kind": "story_time_proposal"
    },
    {
      "field": "proposal_version_id",
      "kind": "story_time_proposal_version"
    },
    {
      "field": "relative_to_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "fact_id",
      "kind": "canonical_fact"
    },
    {
      "field": "state_proposal_id",
      "kind": "state_change_proposal"
    },
    {
      "field": "replaces_timing_id",
      "kind": "story_event_timing"
    }
  ],
  "story_relation_proposal_version": [
    {
      "field": "proposal_id",
      "kind": "story_relation_proposal"
    },
    {
      "field": "source_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "target_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "fact_id",
      "kind": "canonical_fact"
    },
    {
      "field": "state_proposal_id",
      "kind": "state_change_proposal"
    }
  ],
  "story_relation_proposal": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    }
  ],
  "story_event_relation": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "proposal_id",
      "kind": "story_relation_proposal"
    },
    {
      "field": "proposal_version_id",
      "kind": "story_relation_proposal_version"
    },
    {
      "field": "source_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "target_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "epistemic_claim": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "subject_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "object_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "truth_fact_id",
      "kind": "canonical_fact"
    }
  ],
  "knowledge_state_proposal_version": [
    {
      "field": "proposal_id",
      "kind": "knowledge_state_proposal"
    },
    {
      "field": "source_character_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "source_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    }
  ],
  "knowledge_state_proposal": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "holder_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "knowledge_state_change": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "proposal_version_id",
      "kind": "knowledge_state_proposal_version"
    },
    {
      "field": "holder_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "current_knowledge_state_projection": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "holder_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    },
    {
      "field": "source_change_id",
      "kind": "knowledge_state_change"
    }
  ],
  "current_state_projection": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "source_initial_version_id",
      "kind": "entity_initial_state_version"
    },
    {
      "field": "source_state_change_id",
      "kind": "state_change"
    }
  ],
  "entity_initial_state_version": [
    {
      "field": "initial_state_id",
      "kind": "entity_initial_state"
    },
    {
      "field": "source_fact_id",
      "kind": "canonical_fact"
    }
  ],
  "entity_initial_state": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    }
  ],
  "state_change": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "settlement_id",
      "query": "SELECT 1 FROM new_design.chapter_settlements WHERE id=$1"
    },
    {
      "field": "proposal_id",
      "kind": "state_change_proposal"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "cause_event_card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "state_milestone_snapshot": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "chapter_document_id",
      "query": "SELECT 1 FROM new_design.chapter_documents WHERE id=$1"
    },
    {
      "field": "body_version_id",
      "query": "SELECT 1 FROM new_design.chapter_body_versions WHERE id=$1"
    },
    {
      "field": "source_settlement_id",
      "query": "SELECT 1 FROM new_design.chapter_settlements WHERE id=$1"
    }
  ],
  "canonical_fact_conflict": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "fact_a_id",
      "kind": "canonical_fact"
    },
    {
      "field": "fact_b_id",
      "kind": "canonical_fact"
    },
    {
      "field": "resolution_fact_id",
      "kind": "canonical_fact"
    }
  ],
  "state_relation_capability": [
    {
      "field": "space_id",
      "query": "SELECT 1 FROM new_design.card_spaces WHERE id=$1"
    }
  ],
  "state_relation_dimension": [],
  "state_type_capability": [
    {
      "field": "space_id",
      "query": "SELECT 1 FROM new_design.card_spaces WHERE id=$1"
    }
  ],
  "state_field_policy": [],
  "state_change_proposal_version": [
    {
      "field": "proposal_id",
      "kind": "state_change_proposal"
    }
  ],
  "state_value_mapping": [
    {
      "field": "space_id",
      "query": "SELECT 1 FROM new_design.card_spaces WHERE id=$1"
    }
  ],
  "state_value_mapping_version": [
    {
      "field": "mapping_id",
      "kind": "state_value_mapping"
    },
    {
      "field": "prompt_component_version_id",
      "query": "SELECT 1 FROM new_design.card_versions WHERE id=$1"
    }
  ],
  "canonical_fact_evidence": [
    {
      "field": "fact_id",
      "kind": "canonical_fact"
    },
    {
      "field": "chapter_text_anchor_id",
      "query": "SELECT 1 FROM new_design.text_anchors WHERE id=$1"
    },
    {
      "field": "card_version_id",
      "query": "SELECT 1 FROM new_design.card_versions WHERE id=$1"
    },
    {
      "field": "research_evidence_id",
      "kind": "research_evidence"
    }
  ],
  "payoff_window_version": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ],
  "payoff_window": [
    {
      "field": "book_id",
      "query": "SELECT 1 FROM new_design.books WHERE id=$1"
    },
    {
      "field": "card_id",
      "query": "SELECT 1 FROM new_design.cards WHERE id=$1"
    }
  ]
};
