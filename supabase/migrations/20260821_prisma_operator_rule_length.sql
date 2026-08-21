begin;

update public.prisma_operator_rules
set rule = left(rule, 350)
where char_length(rule) > 350;

alter table public.prisma_operator_rules
  drop constraint if exists prisma_operator_rules_rule_check;

alter table public.prisma_operator_rules
  add constraint prisma_operator_rules_rule_check
  check (char_length(rule) between 5 and 350);

commit;
