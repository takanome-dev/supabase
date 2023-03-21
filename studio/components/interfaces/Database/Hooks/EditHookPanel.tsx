import Image from 'next/image'
import { useState, useRef, useEffect } from 'react'
import { Button, SidePanel, Form, Input, Listbox, Checkbox, Radio, Badge } from 'ui'

import { useStore } from 'hooks'
import { tryParseJson, uuidv4 } from 'lib/helpers'
import HTTPRequestFields from './HTTPRequestFields'
import { FormSection, FormSectionLabel, FormSectionContent } from 'components/ui/Forms'
import { useDatabaseTriggerCreateMutation } from 'data/database-triggers/database-trigger-create-mutation'
import { useProjectContext } from 'components/layouts/ProjectLayout/ProjectContext'
import { isValidHttpUrl } from './Hooks.utils'
import { PostgresTrigger } from '@supabase/postgres-meta'
import { useDatabaseTriggerUpdateMutation } from 'data/database-triggers/database-trigger-update-mutation'
import { AVAILABLE_WEBHOOK_TYPES, ENABLED_MODE_OPTIONS, HOOK_EVENTS } from './Hooks.constants'

// Also see if we can add the input field for enabled_mode

export interface EditHookPanelProps {
  visible: boolean
  selectedHook?: PostgresTrigger
  onClose: () => void
}

export type HTTPArgument = { id: string; name: string; value: string }

const EditHookPanel = ({ visible, selectedHook, onClose }: EditHookPanelProps) => {
  // [Joshen] Need to change to use RQ once Alaister's PR goes in
  const { meta, ui } = useStore()
  const submitRef: any = useRef()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // [Joshen] There seems to be some bug between Checkbox.Group within the Form component
  // hence why this external state as a temporary workaround
  const [events, setEvents] = useState<string[]>([])
  const [eventsError, setEventsError] = useState<string>()

  // For HTTP request
  const [httpHeaders, setHttpHeaders] = useState<HTTPArgument[]>([])
  const [httpParameters, setHttpParameters] = useState<HTTPArgument[]>([])

  const { project } = useProjectContext()
  const { mutateAsync: createDatabaseTrigger } = useDatabaseTriggerCreateMutation()
  const { mutateAsync: updateDatabaseTrigger } = useDatabaseTriggerUpdateMutation()

  useEffect(() => {
    if (visible) {
      setIsSubmitting(false)
      // Reset form fields outside of the Form context
      if (selectedHook !== undefined) {
        setEvents(selectedHook.events)

        const [url, method, headers, parameters] = selectedHook.function_args
        const formattedHeaders = tryParseJson(headers) || {}
        setHttpHeaders(
          Object.keys(formattedHeaders).map((key) => {
            return { id: uuidv4(), name: key, value: formattedHeaders[key] }
          })
        )
        const formattedParameters = tryParseJson(parameters) || {}
        setHttpParameters(
          Object.keys(formattedParameters).map((key) => {
            return { id: uuidv4(), name: key, value: formattedParameters[key] }
          })
        )
      } else {
        setEvents([])
        setHttpHeaders([{ id: uuidv4(), name: 'Content-type', value: 'application/json' }])
        setHttpParameters([{ id: uuidv4(), name: '', value: '' }])
      }
    }
  }, [visible, selectedHook])

  const tables = meta.tables.list()

  const initialValues = {
    name: selectedHook?.name ?? '',
    table_id: selectedHook?.table_id ?? '',
    enabled_mode: selectedHook?.enabled_mode ?? 'ORIGIN',
    function_name: selectedHook?.function_name ?? 'http_request',

    http_url: selectedHook?.function_args?.[0] ?? '',
    http_method: selectedHook?.function_args?.[1] ?? '',
  }

  const onUpdateSelectedEvents = (event: string) => {
    if (events.includes(event)) {
      setEvents(events.filter((e) => e !== event))
    } else {
      setEvents(events.concat(event))
    }
    setEventsError(undefined)
  }

  const validate = (values: any) => {
    const errors: any = {}

    if (!values.name) {
      errors['name'] = 'Please provide a name for your webhook'
    }
    if (!values.table_id) {
      errors['table_id'] = 'Please select a table for which your webhook will trigger from'
    }

    if (values.function_name === 'http_request') {
      // For HTTP requests
      if (!values.http_url) {
        errors['http_url'] = 'Please provide a URL'
      } else if (!values.http_url.startsWith('http')) {
        errors['http_url'] = 'Please include HTTP/HTTPs to your URL'
      } else if (!isValidHttpUrl(values.http_url)) {
        errors['http_url'] = 'Please provide a valid URL'
      }
    } else if (values.function_name === 'supabase_function') {
      // For Supabase Edge Functions
    }

    return errors
  }

  const onSubmit = async (values: any) => {
    if (!project?.ref) {
      return console.error('Project ref is required')
    }
    if (events.length === 0) {
      return setEventsError('Please select at least one event')
    }

    const selectedTable = meta.tables.byId(values.table_id)
    if (!selectedTable) {
      return ui.setNotification({ category: 'error', message: 'Unable to find selected table' })
    }

    const payload: any = {
      events,
      activation: 'AFTER',
      orientation: 'ROW',
      name: values.name,
      table: selectedTable.name,
      schema: selectedTable.schema,
      table_id: values.table_id,
      enabled_mode: values.enabled_mode,
      function_name: values.function_name,
      function_schema: 'supabase_functions',
      function_args: [],
    }

    if (values.function_name === 'http_request') {
      const serviceTimeoutMs = '1000'
      const headers = httpHeaders
        .filter((header) => header.name && header.value)
        .reduce((a: any, b: any) => {
          a[b.name] = b.value
          return a
        }, {})
      const parameters = httpParameters
        .filter((param) => param.name && param.value)
        .reduce((a: any, b: any) => {
          a[b.name] = b.value
          return a
        }, {})
      payload.function_args = [
        values.http_url,
        values.http_method,
        JSON.stringify(headers),
        JSON.stringify(parameters),
        serviceTimeoutMs,
      ]
    } else if (values.function_name === 'supabase_function') {
      payload.function_args = []
    }

    if (selectedHook === undefined) {
      try {
        setIsSubmitting(true)
        await createDatabaseTrigger({
          projectRef: project?.ref,
          connectionString: project?.connectionString,
          payload,
        })
        ui.setNotification({
          category: 'success',
          message: `Successfully created new webhook "${values.name}"`,
        })
        onClose()
      } catch (error: any) {
        ui.setNotification({
          error,
          category: 'error',
          message: `Failed to create webhook: ${error.message}`,
        })
      } finally {
        setIsSubmitting(false)
      }
    } else {
      try {
        setIsSubmitting(true)
        await updateDatabaseTrigger({
          id: selectedHook.id,
          projectRef: project?.ref,
          connectionString: project?.connectionString,
          payload,
        })
        ui.setNotification({
          category: 'success',
          message: `Successfully updated webhook "${values.name}"`,
        })
        onClose()
      } catch (error: any) {
        ui.setNotification({
          error,
          category: 'error',
          message: `Failed to update webhook: ${error.message}`,
        })
      } finally {
        setIsSubmitting(false)
      }
    }
  }

  return (
    <SidePanel
      size="xlarge"
      visible={visible}
      header={
        selectedHook === undefined ? (
          'Create a new database webhook'
        ) : (
          <>
            Update webhook <code className="text-sm">{selectedHook.name}</code>
          </>
        )
      }
      className="hooks-sidepanel mr-0 transform transition-all duration-300 ease-in-out"
      onConfirm={() => {}}
      onCancel={() => onClose()}
      customFooter={
        <div className="flex w-full justify-end space-x-3 border-t border-scale-500 px-3 py-4">
          <Button
            size="tiny"
            type="default"
            htmlType="button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            size="tiny"
            type="primary"
            htmlType="button"
            disabled={isSubmitting}
            loading={isSubmitting}
            onClick={() => submitRef?.current?.click()}
          >
            {selectedHook === undefined ? 'Create webhook' : 'Update webhook'}
          </Button>
        </div>
      }
    >
      <Form validateOnBlur initialValues={initialValues} onSubmit={onSubmit} validate={validate}>
        {() => {
          return (
            <div>
              <FormSection
                header={<FormSectionLabel className="lg:!col-span-4">General</FormSectionLabel>}
              >
                <FormSectionContent loading={false} className="lg:!col-span-8">
                  <Input
                    id="name"
                    name="name"
                    label="Name"
                    descriptionText="Do not use spaces/whitespaces"
                  />
                  <Listbox
                    size="medium"
                    id="enabled_mode"
                    name="enabled_mode"
                    label="Enabled mode"
                    descriptionText="Determines if a trigger should or should not fire. Can also be used to disable a trigger, but not delete it"
                  >
                    {ENABLED_MODE_OPTIONS.map((option) => (
                      <Listbox.Option key={option.value} value={option.value} label={option.label}>
                        {option.label}
                        <span className="block text-scale-900">{option.description}</span>
                      </Listbox.Option>
                    ))}
                  </Listbox>
                </FormSectionContent>
              </FormSection>
              <SidePanel.Separator />
              <FormSection
                header={
                  <FormSectionLabel
                    className="lg:!col-span-4"
                    description={
                      <p className="text-sm text-scale-1000">
                        Select which table and events will trigger your function hook
                      </p>
                    }
                  >
                    Conditions to fire hook
                  </FormSectionLabel>
                }
              >
                <FormSectionContent loading={false} className="lg:!col-span-8">
                  <Listbox
                    size="medium"
                    id="table_id"
                    name="table_id"
                    label="Table"
                    descriptionText="This is the table the trigger will watch for changes. You can only select 1 table for a trigger."
                  >
                    <Listbox.Option
                      key={'table-no-selection'}
                      id={'table-no-selection'}
                      label={'---'}
                      value={'no-selection'}
                    >
                      ---
                    </Listbox.Option>
                    {tables.map((table) => (
                      <Listbox.Option
                        key={table.id}
                        id={table.id.toString()}
                        value={table.id}
                        label={table.name}
                      >
                        <div className="flex items-center space-x-2">
                          <p>{table.name}</p>
                          <p className="text-scale-1100">{table.schema}</p>
                        </div>
                      </Listbox.Option>
                    ))}
                  </Listbox>
                  <Checkbox.Group
                    id="events"
                    name="events"
                    label="Events"
                    error={eventsError}
                    descriptionText="These are the events that are watched by the webhook, only the events selected above will fire the webhook on the table you've selected."
                  >
                    {HOOK_EVENTS.map((event) => (
                      <Checkbox
                        key={event.value}
                        value={event.value}
                        label={event.label}
                        description={event.description}
                        checked={events.includes(event.value)}
                        onChange={() => onUpdateSelectedEvents(event.value)}
                      />
                    ))}
                  </Checkbox.Group>
                </FormSectionContent>
              </FormSection>
              <SidePanel.Separator />
              <FormSection
                header={
                  <FormSectionLabel className="lg:!col-span-4">Hook configuration</FormSectionLabel>
                }
              >
                <FormSectionContent loading={false} className="lg:!col-span-8">
                  <Radio.Group
                    id="function_name"
                    name="function_name"
                    label="Type of hook"
                    type="cards"
                  >
                    {AVAILABLE_WEBHOOK_TYPES.map((webhook) => (
                      <Radio
                        disabled={webhook.disabled}
                        key={webhook.value}
                        id={webhook.value}
                        value={webhook.value}
                        label=""
                        beforeLabel={
                          <div className="flex items-center space-x-5">
                            <Image src={webhook.icon} layout="fixed" width="32" height="32" />
                            <div className="flex-col space-y-0">
                              <div className="flex space-x-2">
                                <p className="text-scale-1200">{webhook.label}</p>
                                {webhook.disabled ? (
                                  <Badge color="amber">Coming soon</Badge>
                                ) : (
                                  <Badge color="green">Alpha</Badge>
                                )}
                              </div>
                              <p className="text-scale-1000">{webhook.description}</p>
                            </div>
                          </div>
                        }
                      />
                    ))}
                  </Radio.Group>
                </FormSectionContent>
              </FormSection>
              <SidePanel.Separator />

              <HTTPRequestFields
                httpHeaders={httpHeaders}
                httpParameters={httpParameters}
                onAddHeader={() =>
                  setHttpHeaders(httpHeaders.concat({ id: uuidv4(), name: '', value: '' }))
                }
                onUpdateHeader={(idx, property, value) =>
                  setHttpHeaders(
                    httpHeaders.map((header, i) => {
                      if (idx === i) return { ...header, [property]: value }
                      else return header
                    })
                  )
                }
                onRemoveHeader={(idx) => setHttpHeaders(httpHeaders.filter((_, i) => idx !== i))}
                onAddParameter={() =>
                  setHttpParameters(httpParameters.concat({ id: uuidv4(), name: '', value: '' }))
                }
                onUpdateParameter={(idx, property, value) =>
                  setHttpParameters(
                    httpParameters.map((param, i) => {
                      if (idx === i) return { ...param, [property]: value }
                      else return param
                    })
                  )
                }
                onRemoveParameter={(idx) =>
                  setHttpParameters(httpParameters.filter((_, i) => idx !== i))
                }
              />

              <button ref={submitRef} type="submit" className="hidden" />
            </div>
          )
        }}
      </Form>
    </SidePanel>
  )
}

export default EditHookPanel