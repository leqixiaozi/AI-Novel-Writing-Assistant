import { AiExecutionError } from "../runtime/errors";
export class ChapterSettlementAiError extends AiExecutionError {
  constructor(step:string,summary:string,status:number,readonly mutationOutcome:"not_written"|"unknown",readonly modelRequestState:"not_sent"|"sent_unknown"|"completed") {super(step,summary,status);this.recovery.mutationOutcome=mutationOutcome;}
}
