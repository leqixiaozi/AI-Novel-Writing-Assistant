import {z} from "zod";
import {cardGroupFormInputSchema,cardGroupFormDefinitionSchema,fieldDefinitionSchema} from "../../domain/validation";

const definition=cardGroupFormDefinitionSchema,group=definition.shape.groups.element,section=group.shape.sections.element;
const slot=section.shape.slots.element.safeExtend({localFields:z.array(fieldDefinitionSchema.strict().transform(field=>({...field,defaultValue:field.defaultValue??null}))).max(30).default([])});
export const strictFormInputSchema=cardGroupFormInputSchema.extend({
  definition:definition.extend({groups:z.array(group.extend({sections:z.array(section.extend({slots:z.array(slot).min(1)})).min(1)})).min(1)}),
  requestKey:z.string().uuid().optional(),
});
