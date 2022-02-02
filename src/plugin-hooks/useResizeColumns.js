import React from 'react'

import {
  actions,
  defaultColumn,
  makePropGetter,
  useGetLatest,
  ensurePluginOrder,
  useMountedLayoutEffect,
} from '../publicUtils'

import { getFirstDefined, passiveEventSupported } from '../utils'

// Default Column
defaultColumn.canResize = true

// Actions
actions.columnStartResizing = 'columnStartResizing'
actions.columnResizing = 'columnResizing'
actions.columnDoneResizing = 'columnDoneResizing'
actions.resetResize = 'resetResize'

export const useResizeColumns = hooks => {
  hooks.getResizerProps = [defaultGetResizerProps]
  hooks.getHeaderProps.push({
    style: {
      position: 'relative',
    },
  })
  hooks.stateReducers.push(reducer)
  hooks.useInstance.push(useInstance)
  hooks.useInstanceBeforeDimensions.push(useInstanceBeforeDimensions)
}

const defaultGetResizerProps = (props, { instance, header }) => {
  const { dispatch } = instance

  const onResizeStart = (e, header) => {
    let isTouchEvent = false
    if (e.type === 'touchstart') {
      // lets not respond to multiple touches (e.g. 2 or 3 fingers)
      if (e.touches && e.touches.length > 1) {
        return
      }
      isTouchEvent = true
    }
    const headersToResize = getLeafHeaders(header)
    const leftHeaderIndex = instance.headers.findIndex(h => h.id === header.id)
    const leftHeader = instance.headers[leftHeaderIndex]
    const rightHeader = instance.headers[leftHeaderIndex + 1]
    const headerIdWidths = headersToResize.map(d => [d.id, d.totalWidth])

    const clientX = isTouchEvent ? Math.round(e.touches[0].clientX) : e.clientX

    const dispatchMove = clientXPos => {
      dispatch({ type: actions.columnResizing, clientX: clientXPos })
    }
    const dispatchEnd = () => dispatch({ type: actions.columnDoneResizing })

    const handlersAndEvents = {
      mouse: {
        moveEvent: 'mousemove',
        moveHandler: e => dispatchMove(e.clientX),
        upEvent: 'mouseup',
        upHandler: e => {
          document.removeEventListener(
            'mousemove',
            handlersAndEvents.mouse.moveHandler
          )
          document.removeEventListener(
            'mouseup',
            handlersAndEvents.mouse.upHandler
          )
          dispatchEnd()
        },
      },
      touch: {
        moveEvent: 'touchmove',
        moveHandler: e => {
          if (e.cancelable) {
            e.preventDefault()
            e.stopPropagation()
          }
          dispatchMove(e.touches[0].clientX)
          return false
        },
        upEvent: 'touchend',
        upHandler: e => {
          document.removeEventListener(
            handlersAndEvents.touch.moveEvent,
            handlersAndEvents.touch.moveHandler
          )
          document.removeEventListener(
            handlersAndEvents.touch.upEvent,
            handlersAndEvents.touch.moveHandler
          )
          dispatchEnd()
        },
      },
    }

    const events = isTouchEvent
      ? handlersAndEvents.touch
      : handlersAndEvents.mouse
    const passiveIfSupported = passiveEventSupported()
      ? { passive: false }
      : false
    document.addEventListener(
      events.moveEvent,
      events.moveHandler,
      passiveIfSupported
    )
    document.addEventListener(
      events.upEvent,
      events.upHandler,
      passiveIfSupported
    )

    dispatch({
      type: actions.columnStartResizing,
      columnId: header.id,
      columnWidth: header.totalWidth,
      headerIdWidths,
      leftHeader,
      rightHeader,
      widthUnitPerPx:
        instance.totalColumnsWidth / instance.tableRef.current.clientWidth,
      headers: instance.headers,
      clientX,
    })
  }

  return [
    props,
    {
      onMouseDown: e => e.persist() || onResizeStart(e, header),
      onTouchStart: e => e.persist() || onResizeStart(e, header),
      style: {
        cursor: 'col-resize',
      },
      draggable: false,
      role: 'separator',
    },
  ]
}

useResizeColumns.pluginName = 'useResizeColumns'

function reducer(state, action) {
  if (action.type === actions.init) {
    return {
      columnResizing: {
        columnWidths: {},
      },
      ...state,
    }
  }

  if (action.type === actions.resetResize) {
    return {
      ...state,
      columnResizing: {
        columnWidths: {},
      },
    }
  }

  if (action.type === actions.columnStartResizing) {
    const {
      clientX,
      columnId,
      columnWidth,
      headerIdWidths,
      leftHeader,
      rightHeader,
      widthUnitPerPx,
      headers,
    } = action

    const maxChangePx = [
      Math.max(
        leftHeader.totalMinWidth - leftHeader.totalWidth / widthUnitPerPx,
        rightHeader.totalWidth / widthUnitPerPx - rightHeader.totalMaxWidth
      ),
      Math.min(
        rightHeader.totalWidth / widthUnitPerPx - rightHeader.totalMinWidth,
        leftHeader.totalMaxWidth - leftHeader.totalWidth / widthUnitPerPx
      ),
    ]

    return {
      ...state,
      columnResizing: {
        ...state.columnResizing,
        startX: clientX,
        headerIdWidths,
        leftHeader,
        rightHeader,
        headers,
        widthUnitPerPx,
        maxChangePx,
        leftHeaderInitialWidth: columnWidth,
        rightHeaderInitialWidth: rightHeader.totalWidth,
        isResizingColumn: columnId,
      },
    }
  }

  if (action.type === actions.columnResizing) {
    const { clientX } = action
    const {
      startX,
      leftHeaderInitialWidth,
      rightHeaderInitialWidth,
      widthUnitPerPx,
      maxChangePx,
      leftHeader,
      rightHeader,
    } = state.columnResizing

    const deltaX = Math.max(
      Math.min(clientX - startX, maxChangePx[1]),
      maxChangePx[0]
    )
    const deltaWidthUnit = deltaX * widthUnitPerPx
    const percentageDeltaWidthUnit = deltaWidthUnit / leftHeaderInitialWidth
    const widthChange = leftHeaderInitialWidth * percentageDeltaWidthUnit

    const newColumnWidths = {}
    newColumnWidths[leftHeader.id] = Math.max(
      leftHeaderInitialWidth + widthChange,
      0
    )
    newColumnWidths[rightHeader.id] = Math.max(
      rightHeaderInitialWidth - widthChange,
      0
    )

    return {
      ...state,
      columnResizing: {
        ...state.columnResizing,
        columnWidths: {
          ...state.columnResizing.columnWidths,
          ...newColumnWidths,
        },
      },
    }
  }

  if (action.type === actions.columnDoneResizing) {
    return {
      ...state,
      columnResizing: {
        ...state.columnResizing,
        startX: null,
        isResizingColumn: null,
      },
    }
  }
}

const useInstanceBeforeDimensions = instance => {
  const {
    flatHeaders,
    disableResizing,
    getHooks,
    state: { columnResizing },
  } = instance

  const getInstance = useGetLatest(instance)

  flatHeaders.forEach(header => {
    const canResize = getFirstDefined(
      header.disableResizing === true ? false : undefined,
      disableResizing === true ? false : undefined,
      true
    )

    header.canResize = canResize
    header.width =
      columnResizing.columnWidths[header.id] ||
      header.originalWidth ||
      header.width
    header.isResizing = columnResizing.isResizingColumn === header.id

    if (canResize) {
      header.getResizerProps = makePropGetter(getHooks().getResizerProps, {
        instance: getInstance(),
        header,
      })
    }
  })
}

function useInstance(instance) {
  const { plugins, dispatch, autoResetResize = true, columns } = instance

  ensurePluginOrder(plugins, ['useAbsoluteLayout'], 'useResizeColumns')

  const getAutoResetResize = useGetLatest(autoResetResize)
  useMountedLayoutEffect(() => {
    if (getAutoResetResize()) {
      dispatch({ type: actions.resetResize })
    }
  }, [columns])

  const resetResizing = React.useCallback(
    () => dispatch({ type: actions.resetResize }),
    [dispatch]
  )

  const tableRef = React.useRef()
  instance.getHooks().getTableProps.push({
    ref: tableRef,
  })

  Object.assign(instance, {
    resetResizing,
    tableRef,
  })
}

function getLeafHeaders(header) {
  const leafHeaders = []
  const recurseHeader = header => {
    if (header.columns && header.columns.length) {
      header.columns.map(recurseHeader)
    }
    leafHeaders.push(header)
  }
  recurseHeader(header)
  return leafHeaders
}
