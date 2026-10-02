import { Field, FieldLabel } from "~/components/ui/field";
import WheelSelect from "~/components/WheelSelect";
import {
  useTodoTimeFields,
  type TodoTimeControlProps,
} from "./hooks/use-todo-time-fields";

export default function TodoTimeWheelMobile(props: TodoTimeControlProps) {
  const fields = useTodoTimeFields(props);
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((field) => (
        <Field
          key={field.id}
          data-invalid={props.invalid}
          className="min-w-0 gap-1.5"
        >
          <FieldLabel htmlFor={field.id} className="justify-center">
            {field.label}
          </FieldLabel>
          <WheelSelect
            {...field}
            invalid={props.invalid}
            onChange={field.change}
          />
        </Field>
      ))}
    </div>
  );
}
